# -*- coding: utf-8 -*-
"""
Pure-Python 64-bit NumPy compatibility subset for ZYNTHEOR host environments
where system C-extensions (numpy/pip) are not installed.
When system `numpy` is available, modules import `numpy` directly; otherwise
they fall back to this deterministic stdlib compute implementation.
"""
import builtins as _bi
import math
import operator as _op
import random as _py_random
from typing import Any, Iterable, List, Optional, Sequence, Tuple, Union


float64 = "float64"
int64 = "int64"
bool_ = "bool"


def _infer_shape(obj: Any) -> Tuple[int, ...]:
    if isinstance(obj, ndarray):
        return obj.shape
    if isinstance(obj, (list, tuple)):
        if len(obj) == 0:
            return (0,)
        sub = _infer_shape(obj[0])
        return (len(obj),) + sub
    return ()


def _flatten(obj: Any, dtype: str = float64) -> List[Union[float, int, bool]]:
    if isinstance(obj, ndarray):
        return list(obj._data)
    if isinstance(obj, (list, tuple)):
        out: List[Any] = []
        for item in obj:
            out.extend(_flatten(item, dtype))
        return out
    if dtype == bool_:
        return [bool(obj)]
    if dtype == int64:
        return [int(obj)]
    return [float(obj)]


def _cast(val: Any, dtype: str) -> Union[float, int, bool]:
    if dtype == bool_:
        return bool(val)
    if dtype == int64:
        return int(val)
    return float(val)


def _prod(shape: Tuple[int, ...]) -> int:
    p = 1
    for s in shape:
        p *= s
    return p


def _strides(shape: Tuple[int, ...]) -> Tuple[int, ...]:
    out = []
    acc = 1
    for s in reversed(shape):
        out.append(acc)
        acc *= s
    return tuple(reversed(out))


def _unflatten(data: Sequence[Any], shape: Tuple[int, ...]) -> Any:
    if len(shape) == 0:
        return data[0] if data else 0.0
    if len(shape) == 1:
        return list(data[: shape[0]])
    step = _prod(shape[1:])
    return [_unflatten(data[i * step : (i + 1) * step], shape[1:]) for i in range(shape[0])]


def _broadcast_shapes(s1: Tuple[int, ...], s2: Tuple[int, ...]) -> Tuple[int, ...]:
    r1, r2 = len(s1), len(s2)
    n = _bi.max(r1, r2)
    a = (1,) * (n - r1) + s1
    b = (1,) * (n - r2) + s2
    res = []
    for d1, d2 in zip(a, b):
        if d1 == d2:
            res.append(d1)
        elif d1 == 1:
            res.append(d2)
        elif d2 == 1:
            res.append(d1)
        else:
            raise ValueError(f"Cannot broadcast shapes {s1} and {s2}")
    return tuple(res)


def _as_array(x: Any) -> "ndarray":
    if isinstance(x, ndarray):
        return x
    if isinstance(x, (list, tuple)):
        return array(x)
    return ndarray([float(x)], (), float64)


def _binary_op(a: Any, b: Any, op) -> "ndarray":
    A = _as_array(a)
    B = _as_array(b)
    ad = A._data
    bd = B._data
    if A.shape == B.shape:
        res = list(map(op, ad, bd))
        out_dtype = bool_ if (res and isinstance(res[0], bool)) else (
            float64 if (A.dtype == float64 or B.dtype == float64) else A.dtype
        )
        return ndarray(res, A.shape, out_dtype)

    if len(B.shape) == 0:
        bv = bd[0]
        res = [op(x, bv) for x in ad]
        out_dtype = bool_ if (res and isinstance(res[0], bool)) else (
            float64 if (A.dtype == float64 or isinstance(bv, float)) else A.dtype
        )
        return ndarray(res, A.shape, out_dtype)

    if len(A.shape) == 0:
        av = ad[0]
        res = [op(av, y) for y in bd]
        out_dtype = bool_ if (res and isinstance(res[0], bool)) else (
            float64 if (B.dtype == float64 or isinstance(av, float)) else B.dtype
        )
        return ndarray(res, B.shape, out_dtype)

    # Fast path: trailing 1D vector broadcast e.g. (..., D) op (D,)
    if len(B.shape) == 1 and len(A.shape) >= 2 and A.shape[-1] == B.shape[0]:
        D = B.shape[0]
        res = []
        ext = res.extend
        for start in range(0, len(ad), D):
            ext(map(op, ad[start : start + D], bd))
        out_dtype = bool_ if (res and isinstance(res[0], bool)) else float64
        return ndarray(res, A.shape, out_dtype)

    # Fast path: trailing scalar-axis broadcast e.g. (..., 1) with same leading dims
    if A.shape[:-1] == B.shape[:-1]:
        if B.shape[-1] == 1 and A.shape[-1] > 1:
            D = A.shape[-1]
            res = []
            for i, bv in enumerate(bd):
                off = i * D
                for j in range(D):
                    res.append(op(ad[off + j], bv))
            out_dtype = bool_ if (res and isinstance(res[0], bool)) else float64
            return ndarray(res, A.shape, out_dtype)
        if A.shape[-1] == 1 and B.shape[-1] > 1:
            D = B.shape[-1]
            res = []
            for i, av in enumerate(ad):
                off = i * D
                for j in range(D):
                    res.append(op(av, bd[off + j]))
            out_dtype = bool_ if (res and isinstance(res[0], bool)) else float64
            return ndarray(res, B.shape, out_dtype)

    # Fast path: (B, ...) op (1, ...)
    if len(A.shape) == len(B.shape) and B.shape[0] == 1 and A.shape[1:] == B.shape[1:]:
        blk = len(bd)
        res = []
        ext = res.extend
        for start in range(0, len(ad), blk):
            ext(map(op, ad[start : start + blk], bd))
        out_dtype = bool_ if (res and isinstance(res[0], bool)) else float64
        return ndarray(res, A.shape, out_dtype)

    out_shape = _broadcast_shapes(A.shape, B.shape)
    ndim = len(out_shape)
    sa_pad = (1,) * (ndim - len(A.shape)) + A.shape
    sb_pad = (1,) * (ndim - len(B.shape)) + B.shape
    st_a = _strides(sa_pad)
    st_b = _strides(sb_pad)
    st_a = tuple(0 if sa_pad[i] == 1 else st_a[i] for i in range(ndim))
    st_b = tuple(0 if sb_pad[i] == 1 else st_b[i] for i in range(ndim))
    st_out = _strides(out_shape)

    total = _prod(out_shape)
    res = [None] * total
    for idx in range(total):
        rem = idx
        ia = 0
        ib = 0
        for d in range(ndim):
            coord = rem // st_out[d]
            rem %= st_out[d]
            ia += coord * st_a[d]
            ib += coord * st_b[d]
        res[idx] = op(ad[ia], bd[ib])

    out_dtype = bool_ if (total > 0 and isinstance(res[0], bool)) else float64
    return ndarray(res, out_shape, out_dtype)


class ndarray:
    def __init__(self, data: List[Any], shape: Tuple[int, ...], dtype: str = float64):
        self._data = data
        self.shape = tuple(shape)
        self.dtype = dtype

    @property
    def size(self) -> int:
        return len(self._data)

    @property
    def ndim(self) -> int:
        return len(self.shape)

    @property
    def T(self) -> "ndarray":
        if self.ndim <= 1:
            return self.copy()
        perm = tuple(reversed(range(self.ndim)))
        return self.transpose(*perm)

    def copy(self) -> "ndarray":
        return ndarray(list(self._data), self.shape, self.dtype)

    def astype(self, dtype: str) -> "ndarray":
        return ndarray([_cast(x, dtype) for x in self._data], self.shape, dtype)

    def tolist(self) -> Any:
        return _unflatten(self._data, self.shape)

    def item(self) -> Any:
        return self._data[0]

    def __float__(self) -> float:
        if self.size != 1:
            raise TypeError("only length-1 arrays can be converted to Python scalars")
        return float(self._data[0])

    def __len__(self) -> int:
        return self.shape[0] if self.shape else 0

    def __iter__(self):
        for i in range(len(self)):
            yield self[i]

    def reshape(self, *newshape: int) -> "ndarray":
        if len(newshape) == 1 and isinstance(newshape[0], (tuple, list)):
            newshape = tuple(newshape[0])
        shape_l = list(newshape)
        neg = [i for i, v in enumerate(shape_l) if v == -1]
        if neg:
            known = _prod(tuple(v for v in shape_l if v != -1))
            shape_l[neg[0]] = self.size // known
        return ndarray(list(self._data), tuple(shape_l), self.dtype)

    def squeeze(self, axis: Optional[int] = None) -> "ndarray":
        if axis is not None:
            ax = axis if axis >= 0 else self.ndim + axis
            if self.shape[ax] != 1:
                return self.copy()
            ns = self.shape[:ax] + self.shape[ax + 1 :]
        else:
            ns = tuple(d for d in self.shape if d != 1)
        return ndarray(list(self._data), ns, self.dtype)

    def transpose(self, *axes: int) -> "ndarray":
        if len(axes) == 1 and isinstance(axes[0], (tuple, list)):
            axes = tuple(axes[0])
        if not axes:
            axes = tuple(reversed(range(self.ndim)))
        new_shape = tuple(self.shape[a] for a in axes)
        old_strides = _strides(self.shape)
        new_strides = _strides(new_shape)
        total = self.size
        out = [0.0] * total
        src = self._data
        for idx in range(total):
            rem = idx
            old_idx = 0
            for d, ax in enumerate(axes):
                coord = rem // new_strides[d]
                rem %= new_strides[d]
                old_idx += coord * old_strides[ax]
            out[idx] = src[old_idx]
        return ndarray(out, new_shape, self.dtype)

    def __getitem__(self, key: Any) -> Any:
        if isinstance(key, ndarray) and key.dtype == bool_:
            if self.ndim == 1:
                return ndarray([x for x, m in zip(self._data, key._data) if m], (_bi.sum(1 for m in key._data if m),), self.dtype)
            stride0 = _prod(self.shape[1:])
            rows = []
            cnt = 0
            for i, m in enumerate(key._data):
                if m:
                    rows.extend(self._data[i * stride0 : (i + 1) * stride0])
                    cnt += 1
            return ndarray(rows, (cnt,) + self.shape[1:], self.dtype)

        if not isinstance(key, tuple):
            key = (key,)

        # Expand None axes cleanly
        has_none = any(k is None for k in key)
        if has_none:
            no_none = tuple(k for k in key if k is not None)
            sub = self[no_none] if no_none else self
            if not isinstance(sub, ndarray):
                sub = ndarray([sub], (), self.dtype)
            # Reconstruct target shape with 1s where None appeared
            sub_idx = 0
            new_shape = []
            old_iter = iter(sub.shape)
            for k in key:
                if k is None:
                    new_shape.append(1)
                elif isinstance(k, int):
                    continue
                else:
                    new_shape.append(next(old_iter, 1))
            for rem in old_iter:
                new_shape.append(rem)
            return ndarray(list(sub._data), tuple(new_shape), sub.dtype)

        # Pad trailing slices
        full_key = list(key) + [slice(None)] * (self.ndim - len(key))

        # Support row boolean mask at dim 0 (e.g. X[mask, 2])
        if isinstance(full_key[0], ndarray) and full_key[0].dtype == bool_:
            mask = full_key[0]
            stride0 = _prod(self.shape[1:])
            rows = []
            cnt = 0
            for i, m in enumerate(mask._data):
                if m:
                    rows.extend(self._data[i * stride0 : (i + 1) * stride0])
                    cnt += 1
            sub = ndarray(rows, (cnt,) + self.shape[1:], self.dtype)
            if len(full_key) > 1:
                return sub[(slice(None),) + tuple(full_key[1:])]
            return sub

        # General multi-dim slice/int indexing
        ranges: List[List[int]] = []
        out_shape: List[int] = []
        for dim_sz, k in zip(self.shape, full_key):
            if isinstance(k, int):
                idx = k if k >= 0 else dim_sz + k
                ranges.append([idx])
            elif isinstance(k, slice):
                start, stop, step = k.indices(dim_sz)
                seq = list(range(start, stop, step))
                ranges.append(seq)
                out_shape.append(len(seq))
            elif isinstance(k, (list, ndarray)):
                idxs = list(k._data if isinstance(k, ndarray) else k)
                ranges.append([int(x) for x in idxs])
                out_shape.append(len(idxs))
            else:
                raise IndexError(f"Unsupported index type: {type(k)}")

        strides = _strides(self.shape)
        coords = [[]]
        for r in ranges:
            coords = [c + [v] for c in coords for v in r]
        out = [self._data[_bi.sum(c * st for c, st in zip(coord, strides))] for coord in coords]
        if not out_shape:
            return out[0]
        return ndarray(out, tuple(out_shape), self.dtype)

    def __setitem__(self, key: Any, value: Any) -> None:
        if not isinstance(key, tuple):
            key = (key,)
        full_key = list(key) + [slice(None)] * (self.ndim - len(key))
        ranges: List[List[int]] = []
        for dim_sz, k in zip(self.shape, full_key):
            if isinstance(k, int):
                idx = k if k >= 0 else dim_sz + k
                ranges.append([idx])
            elif isinstance(k, slice):
                start, stop, step = k.indices(dim_sz)
                ranges.append(list(range(start, stop, step)))
            else:
                raise IndexError(f"Unsupported setitem index: {type(k)}")
        strides = _strides(self.shape)
        coords = [[]]
        for r in ranges:
            coords = [c + [v] for c in coords for v in r]
        if isinstance(value, ndarray):
            vals = value._data
        elif isinstance(value, (list, tuple)):
            vals = _flatten(value, self.dtype)
        else:
            vals = [_cast(value, self.dtype)] * len(coords)
        if len(vals) == 1 and len(coords) > 1:
            vals = vals * len(coords)
        for coord, v in zip(coords, vals):
            flat_idx = _bi.sum(c * st for c, st in zip(coord, strides))
            self._data[flat_idx] = _cast(v, self.dtype)

    # Operators
    def __neg__(self): return ndarray([-x for x in self._data], self.shape, self.dtype)
    def __add__(self, o): return _binary_op(self, o, _op.add)
    def __radd__(self, o): return _binary_op(o, self, _op.add)
    def __sub__(self, o): return _binary_op(self, o, _op.sub)
    def __rsub__(self, o): return _binary_op(o, self, _op.sub)
    def __mul__(self, o): return _binary_op(self, o, _op.mul)
    def __rmul__(self, o): return _binary_op(o, self, _op.mul)
    def __truediv__(self, o): return _binary_op(self, o, _op.truediv)
    def __rtruediv__(self, o): return _binary_op(o, self, _op.truediv)
    def __pow__(self, o): return _binary_op(self, o, _op.pow)
    def __lt__(self, o): return _binary_op(self, o, _op.lt)
    def __le__(self, o): return _binary_op(self, o, _op.le)
    def __gt__(self, o): return _binary_op(self, o, _op.gt)
    def __ge__(self, o): return _binary_op(self, o, _op.ge)

    def __iadd__(self, o):
        res = self + o
        self._data = res._data
        return self

    def __isub__(self, o):
        res = self - o
        self._data = res._data
        return self

    def __imul__(self, o):
        res = self * o
        self._data = res._data
        return self

    def __itruediv__(self, o):
        res = self / o
        self._data = res._data
        return self

    def __matmul__(self, o: "ndarray") -> "ndarray":
        return matmul(self, o)


def matmul(a: ndarray, b: ndarray) -> ndarray:
    if a.ndim == 2 and b.ndim == 2:
        M, K = a.shape
        K2, N = b.shape
        if K != K2:
            raise ValueError(f"matmul shape mismatch {a.shape} @ {b.shape}")
        ad, bd = a._data, b._data
        cols = [bd[j::N] for j in range(N)]
        fsum = _bi.sum
        mul = _op.mul
        out = [0.0] * (M * N)
        idx = 0
        for i in range(M):
            a_row = ad[i * K : (i + 1) * K]
            for j in range(N):
                out[idx] = fsum(map(mul, a_row, cols[j]))
                idx += 1
        return ndarray(out, (M, N), float64)

    if a.ndim == 3 and b.ndim == 2:
        B, T, K = a.shape
        K2, N = b.shape
        if K != K2:
            raise ValueError(f"matmul shape mismatch {a.shape} @ {b.shape}")
        m2 = matmul(ndarray(a._data, (B * T, K), float64), b)
        return ndarray(m2._data, (B, T, N), float64)

    if a.ndim == 3 and b.ndim == 3:
        B, M, K = a.shape
        B2, K2, N = b.shape
        if B != B2 or K != K2:
            raise ValueError(f"batched matmul mismatch {a.shape} @ {b.shape}")
        out = [0.0] * (B * M * N)
        ad, bd = a._data, b._data
        sa_b, sb_b, so_b = M * K, K * N, M * N
        fsum = _bi.sum
        mul = _op.mul
        for batch in range(B):
            ab = batch * sa_b
            bb = batch * sb_b
            ob = batch * so_b
            cols = [bd[bb + j : bb + sb_b : N] for j in range(N)]
            for i in range(M):
                a_row = ad[ab + i * K : ab + (i + 1) * K]
                oi = ob + i * N
                for j in range(N):
                    out[oi + j] = fsum(map(mul, a_row, cols[j]))
        return ndarray(out, (B, M, N), float64)

    raise ValueError(f"Unsupported matmul dims {a.shape} @ {b.shape}")


def array(obj: Any, dtype: str = float64) -> ndarray:
    if isinstance(obj, ndarray):
        return obj.astype(dtype)
    shape = _infer_shape(obj)
    return ndarray(_flatten(obj, dtype), shape, dtype)


def zeros(shape: Union[int, Tuple[int, ...]], dtype: str = float64) -> ndarray:
    if isinstance(shape, int):
        shape = (shape,)
    z = False if dtype == bool_ else (0 if dtype == int64 else 0.0)
    return ndarray([z] * _prod(shape), tuple(shape), dtype)


def zeros_like(a: ndarray) -> ndarray:
    return zeros(a.shape, a.dtype)


def ones(shape: Union[int, Tuple[int, ...]], dtype: str = float64) -> ndarray:
    if isinstance(shape, int):
        shape = (shape,)
    o = True if dtype == bool_ else (1 if dtype == int64 else 1.0)
    return ndarray([o] * _prod(shape), tuple(shape), dtype)


def ones_like(a: ndarray) -> ndarray:
    return ones(a.shape, a.dtype)


def full(shape: Union[int, Tuple[int, ...]], fill_value: float, dtype: str = float64) -> ndarray:
    if isinstance(shape, int):
        shape = (shape,)
    return ndarray([_cast(fill_value, dtype)] * _prod(shape), tuple(shape), dtype)


def copy(a: ndarray) -> ndarray:
    return a.copy()


def _map_unary(x: Any, fn) -> ndarray:
    a = _as_array(x)
    return ndarray([fn(v) for v in a._data], a.shape, float64)


def exp(x: Any) -> ndarray:
    return _map_unary(x, lambda v: math.exp(_bi.max(-700.0, _bi.min(700.0, float(v)))))


def tanh(x: Any) -> ndarray:
    return _map_unary(x, lambda v: math.tanh(float(v)))


def sqrt(x: Any) -> ndarray:
    return _map_unary(x, lambda v: math.sqrt(_bi.max(0.0, float(v))))


def abs(x: Any) -> ndarray:  # noqa: A001
    return _map_unary(x, lambda v: math.fabs(float(v)))


def clip(x: Any, a_min: float, a_max: float) -> ndarray:
    return _map_unary(x, lambda v: a_min if v < a_min else (a_max if v > a_max else float(v)))


def swapaxes(a: ndarray, axis1: int, axis2: int) -> ndarray:
    ax1 = axis1 if axis1 >= 0 else a.ndim + axis1
    ax2 = axis2 if axis2 >= 0 else a.ndim + axis2
    perm = list(range(a.ndim))
    perm[ax1], perm[ax2] = perm[ax2], perm[ax1]
    return a.transpose(*perm)


def triu(m: ndarray, k: int = 0) -> ndarray:
    R, C = m.shape
    out = list(m._data)
    for r in range(R):
        for c in range(C):
            if c - r < k:
                out[r * C + c] = 0.0
    return ndarray(out, m.shape, m.dtype)


def _reduce(x: Any, axis: Optional[Union[int, Tuple[int, ...]]], keepdims: bool, reducer) -> Any:
    a = _as_array(x)
    if axis is None:
        val = reducer(a._data)
        if keepdims:
            return ndarray([val], (1,) * a.ndim, float64)
        return val
    axes = (axis,) if isinstance(axis, int) else tuple(axis)
    axes_norm = tuple(ax if ax >= 0 else a.ndim + ax for ax in axes)
    keep_dims = [i for i in range(a.ndim) if i not in axes_norm]
    out_shape = tuple(a.shape[i] for i in keep_dims)
    groups: List[List[float]] = [[] for _ in range(_bi.max(1, _prod(out_shape)))]
    st_in = _strides(a.shape)
    st_out = _strides(out_shape) if out_shape else ()
    for idx, val in enumerate(a._data):
        rem = idx
        coords = []
        for s in st_in:
            coords.append(rem // s)
            rem %= s
        out_idx = _bi.sum(coords[d] * st_out[j] for j, d in enumerate(keep_dims))
        groups[out_idx].append(val)
    res = [reducer(g) for g in groups]
    if keepdims:
        kd_shape = tuple(1 if i in axes_norm else a.shape[i] for i in range(a.ndim))
        return ndarray(res, kd_shape, float64)
    if not out_shape:
        return res[0]
    return ndarray(res, out_shape, float64)


def sum(x: Any, axis: Optional[Union[int, Tuple[int, ...]]] = None, keepdims: bool = False) -> Any:  # noqa: A001
    return _reduce(x, axis, keepdims, lambda g: float(math.fsum(g)))


def mean(x: Any, axis: Optional[Union[int, Tuple[int, ...]]] = None, keepdims: bool = False) -> Any:
    return _reduce(x, axis, keepdims, lambda g: math.fsum(g) / len(g) if g else 0.0)


def max(x: Any, axis: Optional[Union[int, Tuple[int, ...]]] = None, keepdims: bool = False) -> Any:  # noqa: A001
    import builtins as _bi
    return _reduce(x, axis, keepdims, lambda g: float(_bi.max(g)))


def var(x: Any) -> float:
    a = _as_array(x)
    n = a.size
    if n == 0:
        return 0.0
    m = math.fsum(a._data) / n
    return math.fsum((v - m) * (v - m) for v in a._data) / n


def std(x: Any) -> float:
    return math.sqrt(var(x))


def concatenate(arrays: Sequence[ndarray], axis: int = 0) -> ndarray:
    if axis != 0:
        raise NotImplementedError("np_compat.concatenate currently handles axis=0")
    shape0 = arrays[0].shape[1:]
    data: List[Any] = []
    total0 = 0
    for arr in arrays:
        data.extend(arr._data)
        total0 += arr.shape[0]
    return ndarray(data, (total0,) + shape0, arrays[0].dtype)


def einsum(subscripts: str, a: ndarray, b: ndarray) -> ndarray:
    if subscripts == "bti,btj->ij":
        B, T, I = a.shape
        B2, T2, J = b.shape
        if B != B2 or T != T2:
            raise ValueError("einsum bti,btj->ij dimension mismatch")
        a2 = ndarray(a._data, (B * T, I), float64)
        b2 = ndarray(b._data, (B * T, J), float64)
        return matmul(a2.T, b2)
    raise NotImplementedError(f"np_compat.einsum only implements bti,btj->ij, got {subscripts}")


class _CompatRNG:
    def __init__(self, seed: Optional[int] = None):
        self._rng = _py_random.Random(seed)

    def uniform(self, low: float = 0.0, high: float = 1.0, size: Optional[Union[int, Tuple[int, ...]]] = None) -> Any:
        if size is None:
            return self._rng.uniform(low, high)
        shape = (size,) if isinstance(size, int) else tuple(size)
        return ndarray([self._rng.uniform(low, high) for _ in range(_prod(shape))], shape, float64)

    def normal(self, loc: float = 0.0, scale: float = 1.0, size: Optional[Union[int, Tuple[int, ...]]] = None) -> Any:
        if size is None:
            return self._rng.gauss(loc, scale)
        shape = (size,) if isinstance(size, int) else tuple(size)
        return ndarray([self._rng.gauss(loc, scale) for _ in range(_prod(shape))], shape, float64)

    def choice(self, a: Union[int, Sequence[Any]], size: Optional[int] = None, replace: bool = True) -> Any:
        pop = list(range(a)) if isinstance(a, int) else list(a)
        if size is None:
            return self._rng.choice(pop)
        if replace:
            chosen = [self._rng.choice(pop) for _ in range(size)]
        else:
            chosen = self._rng.sample(pop, size)
        dtype = int64 if all(isinstance(v, int) for v in chosen) else float64
        return ndarray(chosen, (size,), dtype)


class _RandomModule:
    @staticmethod
    def default_rng(seed: Optional[int] = None) -> _CompatRNG:
        return _CompatRNG(seed)


random = _RandomModule()


def default_rng(seed: Optional[int] = None) -> _CompatRNG:
    return _CompatRNG(seed)
