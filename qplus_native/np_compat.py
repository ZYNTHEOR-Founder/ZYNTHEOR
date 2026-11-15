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
import struct as _struct
from typing import Any, Iterable, List, Optional, Sequence, Tuple, Union


float64 = "float64"
float32 = "float32"
int64 = "int64"
int32 = "int32"
bool_ = "bool"


class _DType:
    def __init__(self, name: str):
        self.name = _norm_dtype(name)

    @property
    def itemsize(self) -> int:
        if self.name in (float32, int32):
            return 4
        if self.name == bool_:
            return 1
        return 8

    def __eq__(self, other: Any) -> bool:
        try:
            return self.name == _norm_dtype(other)
        except Exception:
            return False

    def __hash__(self) -> int:
        return hash(self.name)

    def __repr__(self) -> str:
        return f"dtype('{self.name}')"


def _norm_dtype(dt: Any) -> str:
    if isinstance(dt, _DType):
        return dt.name
    if dt is None or dt is float or dt == "float" or dt == "float64" or dt == "<f8":
        return float64
    if dt == "float32" or dt == "<f4":
        return float32
    if dt is int or dt == "int" or dt == "int64" or dt == "<i8":
        return int64
    if dt == "int32" or dt == "<i4":
        return int32
    if dt is bool or dt == "bool":
        return bool_
    s = str(dt)
    if "float32" in s or "f4" in s:
        return float32
    if "int32" in s or "i4" in s:
        return int32
    if "int" in s:
        return int64
    if "bool" in s:
        return bool_
    return float64


def dtype(dt: Any) -> _DType:
    return _DType(dt)


def _infer_dtype(obj: Any) -> str:
    if isinstance(obj, ndarray):
        return obj.dtype
    if isinstance(obj, bool):
        return bool_
    if isinstance(obj, int):
        return int64
    if isinstance(obj, (list, tuple)) and obj:
        return _infer_dtype(obj[0])
    return float64


def _infer_shape(obj: Any) -> Tuple[int, ...]:
    if isinstance(obj, ndarray):
        return obj.shape
    if isinstance(obj, (list, tuple)):
        if len(obj) == 0:
            return (0,)
        sub = _infer_shape(obj[0])
        return (len(obj),) + sub
    return ()


def _flatten(obj: Any, dtype: Any = float64) -> List[Union[float, int, bool]]:
    dt = _norm_dtype(dtype)
    if isinstance(obj, ndarray):
        return [_cast(v, dt) for v in obj._data]
    if isinstance(obj, (list, tuple)):
        out: List[Any] = []
        for item in obj:
            out.extend(_flatten(item, dt))
        return out
    if dt == bool_:
        return [bool(obj)]
    if dt in (int64, int32):
        return [int(obj)]
    return [float(obj)]


def _cast(val: Any, dtype: Any) -> Union[float, int, bool]:
    dt = _norm_dtype(dtype)
    if dt == bool_:
        return bool(val)
    if dt in (int64, int32):
        return int(val)
    return float(val)


def _is_int_like(x: Any) -> bool:
    return isinstance(x, int) and not isinstance(x, bool)


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
        return array(x, dtype=_infer_dtype(x))
    dt = _infer_dtype(x)
    return ndarray([_cast(x, dt)], (), dt)


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
    def __init__(self, data: List[Any], shape: Tuple[int, ...], dtype: Any = float64):
        self._data = data
        self.shape = tuple(shape)
        self.dtype = _norm_dtype(dtype)

    @property
    def size(self) -> int:
        return len(self._data)

    @property
    def ndim(self) -> int:
        return len(self.shape)

    @property
    def itemsize(self) -> int:
        if self.dtype in (float32, int32):
            return 4
        if self.dtype == bool_:
            return 1
        return 8

    @property
    def nbytes(self) -> int:
        return self.size * self.itemsize

    @property
    def T(self) -> "ndarray":
        if self.ndim <= 1:
            return self.copy()
        perm = tuple(reversed(range(self.ndim)))
        return self.transpose(*perm)

    def copy(self) -> "ndarray":
        return ndarray(list(self._data), self.shape, self.dtype)

    def astype(self, dtype: Any, copy: bool = True) -> "ndarray":
        dt = _norm_dtype(dtype)
        if not copy and dt == self.dtype:
            return self
        return ndarray([_cast(x, dt) for x in self._data], self.shape, dt)

    def tobytes(self) -> bytes:
        if self.dtype == float32:
            return _struct.pack(f"<{len(self._data)}f", *(float(x) for x in self._data))
        if self.dtype == int32:
            return _struct.pack(f"<{len(self._data)}i", *(int(x) for x in self._data))
        if self.dtype == int64:
            return _struct.pack(f"<{len(self._data)}q", *(int(x) for x in self._data))
        if self.dtype == bool_:
            return _struct.pack(f"<{len(self._data)}?", *(bool(x) for x in self._data))
        return _struct.pack(f"<{len(self._data)}d", *(float(x) for x in self._data))

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
        return ndarray(self._data, tuple(shape_l), self.dtype)

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

    def _expand_ellipsis(self, key: Tuple[Any, ...]) -> Tuple[Any, ...]:
        ellipsis_pos = next((i for i, k in enumerate(key) if k is Ellipsis), -1)
        if ellipsis_pos < 0:
            return key
        consumed_dims = _bi.sum(1 for k in key if k is not None and k is not Ellipsis)
        fill = _bi.max(0, self.ndim - consumed_dims)
        return key[:ellipsis_pos] + (slice(None),) * fill + key[ellipsis_pos + 1 :]

    def _broadcast_fancy_coords(self, full_key: List[Any]) -> Optional[Tuple[Tuple[int, ...], List[int], Tuple[int, ...]]]:
        """Handles tuple indexing when one or more positions are ndarray/list integer indices."""
        array_axes = [i for i, k in enumerate(full_key) if isinstance(k, (ndarray, list))]
        if not array_axes:
            return None
        # Only fast-handle trailing full slices or all axes bound by int/array
        last_fancy = _bi.max(array_axes)
        trailing_all_full = _bi.all(isinstance(k, slice) and k == slice(None) for k in full_key[last_fancy + 1 :])
        pre_only_int_or_arr = _bi.all(
            isinstance(k, (ndarray, list)) or _is_int_like(k)
            for k in full_key[: last_fancy + 1]
        )
        if not (trailing_all_full and pre_only_int_or_arr):
            return None

        idx_arrays: List[ndarray] = []
        for ax in range(last_fancy + 1):
            k = full_key[ax]
            arr_k = k if isinstance(k, ndarray) else array(k, dtype=int64)
            if arr_k.dtype in (float64, float32):
                arr_k = arr_k.astype(int64)
            idx_arrays.append(arr_k)

        bshape = ()
        for arr_k in idx_arrays:
            bshape = _broadcast_shapes(bshape, arr_k.shape)

        # Broadcast each index array to bshape
        b_total = _prod(bshape)
        b_strides = _strides(bshape)
        b_lists: List[List[int]] = []
        for ax, arr_k in enumerate(idx_arrays):
            dim_sz = self.shape[ax]
            if arr_k.shape == bshape:
                vals = [int(v) if int(v) >= 0 else dim_sz + int(v) for v in arr_k._data]
            elif arr_k.ndim == 0:
                v0 = int(arr_k._data[0])
                v0 = v0 if v0 >= 0 else dim_sz + v0
                vals = [v0] * b_total
            else:
                pad_shape = (1,) * (len(bshape) - arr_k.ndim) + arr_k.shape
                st = _strides(pad_shape)
                st = tuple(0 if pad_shape[d] == 1 else st[d] for d in range(len(bshape)))
                vals = []
                for idx in range(b_total):
                    rem = idx
                    src_i = 0
                    for d in range(len(bshape)):
                        coord = rem // b_strides[d]
                        rem %= b_strides[d]
                        src_i += coord * st[d]
                    v = int(arr_k._data[src_i])
                    vals.append(v if v >= 0 else dim_sz + v)
            b_lists.append(vals)

        in_strides = _strides(self.shape)
        trail_shape = self.shape[last_fancy + 1 :]
        trail_sz = _prod(trail_shape)
        flat_offsets: List[int] = []
        for i in range(b_total):
            base = _bi.sum(b_lists[ax][i] * in_strides[ax] for ax in range(last_fancy + 1))
            if trail_sz == 1 and not trail_shape:
                flat_offsets.append(base)
            else:
                flat_offsets.extend(range(base, base + trail_sz))
        return bshape + trail_shape, flat_offsets, bshape

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

        key = self._expand_ellipsis(key)

        # Expand None axes cleanly
        has_none = _bi.any(k is None for k in key)
        if has_none:
            no_none = tuple(k for k in key if k is not None)
            sub = self[no_none] if no_none else self
            if not isinstance(sub, ndarray):
                sub = ndarray([sub], (), self.dtype)
            new_shape = []
            old_iter = iter(sub.shape)
            for k in key:
                if k is None:
                    new_shape.append(1)
                elif _is_int_like(k):
                    continue
                elif isinstance(k, ndarray) and k.ndim > 1:
                    for _ in range(k.ndim):
                        new_shape.append(next(old_iter, 1))
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

        # Broadcasted array indexing (e.g. tok_emb[tokens], probs[b_idx, s_idx, labels])
        fancy = self._broadcast_fancy_coords(full_key)
        if fancy is not None:
            out_shape, flat_offsets, _ = fancy
            out_data = [self._data[idx] for idx in flat_offsets]
            if not out_shape:
                return out_data[0]
            return ndarray(out_data, out_shape, self.dtype)

        # General multi-dim slice/int indexing
        ranges: List[List[int]] = []
        out_shape: List[int] = []
        for dim_sz, k in zip(self.shape, full_key):
            if _is_int_like(k):
                idx = k if k >= 0 else dim_sz + k
                ranges.append([idx])
            elif isinstance(k, slice):
                start, stop, step = k.indices(dim_sz)
                seq = list(range(start, stop, step))
                ranges.append(seq)
                out_shape.append(len(seq))
            elif isinstance(k, (list, ndarray)):
                idxs = list(k._data if isinstance(k, ndarray) else k)
                ranges.append([int(x) if int(x) >= 0 else dim_sz + int(x) for x in idxs])
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
        if isinstance(key, ndarray) and key.dtype == bool_:
            if self.shape == key.shape:
                vals = _flatten(value, self.dtype) if isinstance(value, (ndarray, list, tuple)) else None
                vi = 0
                for i, m in enumerate(key._data):
                    if m:
                        if vals is not None:
                            self._data[i] = _cast(vals[vi % len(vals)], self.dtype)
                            vi += 1
                        else:
                            self._data[i] = _cast(value, self.dtype)
                return

        if not isinstance(key, tuple):
            key = (key,)
        key = self._expand_ellipsis(key)
        full_key = list(key) + [slice(None)] * (self.ndim - len(key))

        fancy = self._broadcast_fancy_coords(full_key)
        if fancy is not None:
            _, flat_offsets, _ = fancy
            if isinstance(value, ndarray):
                vals = value._data
            elif isinstance(value, (list, tuple)):
                vals = _flatten(value, self.dtype)
            else:
                vals = [_cast(value, self.dtype)] * len(flat_offsets)
            if len(vals) == 1 and len(flat_offsets) > 1:
                vals = vals * len(flat_offsets)
            for flat_idx, v in zip(flat_offsets, vals):
                self._data[flat_idx] = _cast(v, self.dtype)
            return

        ranges: List[List[int]] = []
        for dim_sz, k in zip(self.shape, full_key):
            if _is_int_like(k):
                idx = k if k >= 0 else dim_sz + k
                ranges.append([idx])
            elif isinstance(k, slice):
                start, stop, step = k.indices(dim_sz)
                ranges.append(list(range(start, stop, step)))
            elif isinstance(k, (list, ndarray)):
                idxs = list(k._data if isinstance(k, ndarray) else k)
                ranges.append([int(x) if int(x) >= 0 else dim_sz + int(x) for x in idxs])
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

    # Reduction convenience methods
    def sum(self, axis: Optional[Union[int, Tuple[int, ...]]] = None, keepdims: bool = False) -> Any:
        return sum(self, axis=axis, keepdims=keepdims)

    def mean(self, axis: Optional[Union[int, Tuple[int, ...]]] = None, keepdims: bool = False) -> Any:
        return mean(self, axis=axis, keepdims=keepdims)

    def max(self, axis: Optional[Union[int, Tuple[int, ...]]] = None, keepdims: bool = False) -> Any:
        return max(self, axis=axis, keepdims=keepdims)

    def any(self, axis: Optional[Union[int, Tuple[int, ...]]] = None, keepdims: bool = False) -> Any:
        return any(self, axis=axis, keepdims=keepdims)

    def all(self, axis: Optional[Union[int, Tuple[int, ...]]] = None, keepdims: bool = False) -> Any:
        return all(self, axis=axis, keepdims=keepdims)

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
    def __eq__(self, o): return _binary_op(self, o, _op.eq)  # type: ignore[override]
    def __ne__(self, o): return _binary_op(self, o, _op.ne)  # type: ignore[override]

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

    if a.ndim >= 3 and b.ndim == 2:
        leading = a.shape[:-2]
        M, K = a.shape[-2], a.shape[-1]
        K2, N = b.shape
        if K != K2:
            raise ValueError(f"matmul shape mismatch {a.shape} @ {b.shape}")
        m2 = matmul(ndarray(a._data, (_prod(leading) * M, K), float64), b)
        return ndarray(m2._data, leading + (M, N), float64)

    if a.ndim >= 3 and b.ndim == a.ndim and a.shape[:-2] == b.shape[:-2]:
        leading = a.shape[:-2]
        B = _prod(leading)
        M, K = a.shape[-2], a.shape[-1]
        K2, N = b.shape[-2], b.shape[-1]
        if K != K2:
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
        return ndarray(out, leading + (M, N), float64)

    raise ValueError(f"Unsupported matmul dims {a.shape} @ {b.shape}")


def array(obj: Any, dtype: Any = None) -> ndarray:
    if isinstance(obj, ndarray):
        dt = _norm_dtype(dtype) if dtype is not None else obj.dtype
        return obj.astype(dt, copy=True)
    dt = _norm_dtype(dtype) if dtype is not None else _infer_dtype(obj)
    shape = _infer_shape(obj)
    return ndarray(_flatten(obj, dt), shape, dt)


def asarray(obj: Any, dtype: Any = None) -> ndarray:
    if isinstance(obj, ndarray) and (dtype is None or _norm_dtype(dtype) == obj.dtype):
        return obj
    return array(obj, dtype=dtype)


def arange(start: Union[int, float], stop: Optional[Union[int, float]] = None, step: Union[int, float] = 1, dtype: Any = None) -> ndarray:
    if stop is None:
        start, stop = 0, start
    vals = []
    cur = start
    if step > 0:
        while cur < stop:
            vals.append(cur)
            cur += step
    elif step < 0:
        while cur > stop:
            vals.append(cur)
            cur += step
    dt = _norm_dtype(dtype) if dtype is not None else (int64 if _is_int_like(start) and _is_int_like(stop) and _is_int_like(step) else float64)
    return ndarray([_cast(v, dt) for v in vals], (len(vals),), dt)


def zeros(shape: Union[int, Tuple[int, ...]], dtype: Any = float64) -> ndarray:
    if isinstance(shape, int):
        shape = (shape,)
    dt = _norm_dtype(dtype)
    z = False if dt == bool_ else (0 if dt in (int64, int32) else 0.0)
    return ndarray([z] * _prod(shape), tuple(shape), dt)


def zeros_like(a: ndarray, dtype: Any = None) -> ndarray:
    return zeros(a.shape, dtype if dtype is not None else a.dtype)


def ones(shape: Union[int, Tuple[int, ...]], dtype: Any = float64) -> ndarray:
    if isinstance(shape, int):
        shape = (shape,)
    dt = _norm_dtype(dtype)
    o = True if dt == bool_ else (1 if dt in (int64, int32) else 1.0)
    return ndarray([o] * _prod(shape), tuple(shape), dt)


def ones_like(a: ndarray, dtype: Any = None) -> ndarray:
    return ones(a.shape, dtype if dtype is not None else a.dtype)


def full(shape: Union[int, Tuple[int, ...]], fill_value: Any, dtype: Any = None) -> ndarray:
    if isinstance(shape, int):
        shape = (shape,)
    dt = _norm_dtype(dtype) if dtype is not None else _infer_dtype(fill_value)
    return ndarray([_cast(fill_value, dt)] * _prod(shape), tuple(shape), dt)


def copy(a: ndarray) -> ndarray:
    return a.copy()


def _map_unary(x: Any, fn, out_dtype: Any = float64) -> ndarray:
    a = _as_array(x)
    dt = _norm_dtype(out_dtype)
    return ndarray([fn(v) for v in a._data], a.shape, dt)


def exp(x: Any) -> ndarray:
    return _map_unary(x, lambda v: math.exp(_bi.max(-700.0, _bi.min(700.0, float(v)))))


def log(x: Any) -> ndarray:
    return _map_unary(x, lambda v: math.log(_bi.max(1e-300, float(v))))


def tanh(x: Any) -> ndarray:
    return _map_unary(x, lambda v: math.tanh(float(v)))


def sqrt(x: Any) -> ndarray:
    return _map_unary(x, lambda v: math.sqrt(_bi.max(0.0, float(v))))


def abs(x: Any) -> ndarray:  # noqa: A001
    return _map_unary(x, lambda v: math.fabs(float(v)))


def clip(x: Any, a_min: float, a_max: float) -> ndarray:
    return _map_unary(x, lambda v: a_min if v < a_min else (a_max if v > a_max else float(v)))


def isfinite(x: Any) -> Any:
    if isinstance(x, ndarray):
        return ndarray([math.isfinite(float(v)) for v in x._data], x.shape, bool_)
    return math.isfinite(float(x))


def where(condition: Any, x: Any = None, y: Any = None) -> ndarray:
    cond = _as_array(condition).astype(bool_, copy=False)
    if x is None and y is None:
        raise NotImplementedError("np_compat.where(condition) without x, y is not supported")
    xa = _as_array(x)
    ya = _as_array(y)
    out_shape = _broadcast_shapes(cond.shape, _broadcast_shapes(xa.shape, ya.shape))
    ndim = len(out_shape)
    st_out = _strides(out_shape)

    def _pad_strides(shape: Tuple[int, ...]) -> Tuple[int, ...]:
        pad = (1,) * (ndim - len(shape)) + shape
        st = _strides(pad)
        return tuple(0 if pad[i] == 1 else st[i] for i in range(ndim))

    sc = _pad_strides(cond.shape)
    sx = _pad_strides(xa.shape)
    sy = _pad_strides(ya.shape)
    total = _prod(out_shape)
    out = [None] * total
    cd, xd, yd = cond._data, xa._data, ya._data
    for idx in range(total):
        rem = idx
        ic = ix = iy = 0
        for d in range(ndim):
            coord = rem // st_out[d]
            rem %= st_out[d]
            ic += coord * sc[d]
            ix += coord * sx[d]
            iy += coord * sy[d]
        out[idx] = xd[ix] if cd[ic] else yd[iy]
    out_dt = xa.dtype if xa.dtype == ya.dtype else float64
    return ndarray(out, out_shape, out_dt)


def prod(x: Any) -> Union[int, float]:
    if isinstance(x, ndarray):
        acc = 1
        for v in x._data:
            acc *= v
        return acc
    acc = 1
    for v in x:
        acc *= v
    return acc


def frombuffer(buf: Union[bytes, bytearray, memoryview], dtype: Any = float32) -> ndarray:
    dt = _norm_dtype(dtype)
    if dt == float32:
        fmt, itemsize = "f", 4
    elif dt == int32:
        fmt, itemsize = "i", 4
    elif dt == int64:
        fmt, itemsize = "q", 8
    elif dt == bool_:
        fmt, itemsize = "?", 1
    else:
        fmt, itemsize = "d", 8
    n = len(buf) // itemsize
    vals = list(_struct.unpack(f"<{n}{fmt}", memoryview(buf)[: n * itemsize]))
    return ndarray(vals, (n,), dt)


def take_along_axis(arr: ndarray, indices: ndarray, axis: int = -1) -> ndarray:
    ax = axis if axis >= 0 else arr.ndim + axis
    if ax == arr.ndim - 1 and arr.ndim >= 2 and indices.shape[:-1] == arr.shape[:-1]:
        K = indices.shape[-1]
        V = arr.shape[-1]
        out = []
        outer = _prod(arr.shape[:-1])
        ad = arr._data
        idxd = indices._data
        for o in range(outer):
            a_off = o * V
            i_off = o * K
            for k in range(K):
                ii = int(idxd[i_off + k])
                if ii < 0:
                    ii += V
                out.append(ad[a_off + ii])
        return ndarray(out, indices.shape, arr.dtype)
    raise NotImplementedError("np_compat.take_along_axis supports last-axis gather matching leading shape")


def swapaxes(a: ndarray, axis1: int, axis2: int) -> ndarray:
    ax1 = axis1 if axis1 >= 0 else a.ndim + axis1
    ax2 = axis2 if axis2 >= 0 else a.ndim + axis2
    perm = list(range(a.ndim))
    perm[ax1], perm[ax2] = perm[ax2], perm[ax1]
    return a.transpose(*perm)


def triu(m: ndarray, k: int = 0) -> ndarray:
    R, C = m.shape
    out = list(m._data)
    z = False if m.dtype == bool_ else (0 if m.dtype in (int64, int32) else 0.0)
    for r in range(R):
        for c in range(C):
            if c - r < k:
                out[r * C + c] = z
    return ndarray(out, m.shape, m.dtype)


def _reduce(x: Any, axis: Optional[Union[int, Tuple[int, ...]]], keepdims: bool, reducer, out_dtype: Optional[str] = None) -> Any:
    a = _as_array(x)
    dt = out_dtype or float64
    if axis is None:
        val = reducer(a._data)
        if keepdims:
            return ndarray([val], (1,) * a.ndim, dt)
        return val
    axes = (axis,) if isinstance(axis, int) else tuple(axis)
    axes_norm = tuple(ax if ax >= 0 else a.ndim + ax for ax in axes)
    keep_dims = [i for i in range(a.ndim) if i not in axes_norm]
    out_shape = tuple(a.shape[i] for i in keep_dims)
    groups: List[List[Any]] = [[] for _ in range(_bi.max(1, _prod(out_shape)))]
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
        return ndarray(res, kd_shape, dt)
    if not out_shape:
        return res[0]
    return ndarray(res, out_shape, dt)


def sum(x: Any, axis: Optional[Union[int, Tuple[int, ...]]] = None, keepdims: bool = False) -> Any:  # noqa: A001
    a = _as_array(x)
    if a.dtype in (bool_, int64, int32):
        return _reduce(a, axis, keepdims, lambda g: int(_bi.sum(1 if v else 0 for v in g)) if a.dtype == bool_ else int(_bi.sum(g)), out_dtype=int64)
    return _reduce(a, axis, keepdims, lambda g: float(math.fsum(g)))


def mean(x: Any, axis: Optional[Union[int, Tuple[int, ...]]] = None, keepdims: bool = False) -> Any:
    return _reduce(x, axis, keepdims, lambda g: math.fsum(g) / len(g) if g else 0.0)


def max(x: Any, axis: Optional[Union[int, Tuple[int, ...]]] = None, keepdims: bool = False) -> Any:  # noqa: A001
    return _reduce(x, axis, keepdims, lambda g: float(_bi.max(g)))


def any(x: Any, axis: Optional[Union[int, Tuple[int, ...]]] = None, keepdims: bool = False) -> Any:  # noqa: A001
    return _reduce(x, axis, keepdims, lambda g: bool(_bi.any(g)), out_dtype=bool_)


def all(x: Any, axis: Optional[Union[int, Tuple[int, ...]]] = None, keepdims: bool = False) -> Any:  # noqa: A001
    return _reduce(x, axis, keepdims, lambda g: bool(_bi.all(g)), out_dtype=bool_)


def var(x: Any) -> float:
    a = _as_array(x)
    n = a.size
    if n == 0:
        return 0.0
    m = math.fsum(a._data) / n
    return math.fsum((v - m) * (v - m) for v in a._data) / n


def std(x: Any) -> float:
    return math.sqrt(var(x))


def argmax(x: Any, axis: Optional[int] = None) -> Any:
    a = _as_array(x)
    if axis is None:
        return _bi.max(range(a.size), key=a._data.__getitem__)
    raise NotImplementedError("np_compat.argmax supports axis=None")


def argsort(x: Any, axis: int = -1) -> ndarray:
    a = _as_array(x)
    if a.ndim != 1:
        raise NotImplementedError("np_compat.argsort supports 1D arrays")
    order = sorted(range(a.size), key=a._data.__getitem__)
    return ndarray(order, a.shape, int64)


def partition(x: Any, kth: int, axis: int = -1) -> ndarray:
    a = _as_array(x)
    if a.ndim != 1:
        raise NotImplementedError("np_compat.partition supports 1D arrays")
    s = sorted(a._data)
    return ndarray(s, a.shape, a.dtype)


def cumsum(x: Any) -> ndarray:
    a = _as_array(x)
    out = []
    acc = 0.0
    for v in a._data:
        acc += float(v)
        out.append(acc)
    return ndarray(out, (a.size,), float64)


def searchsorted(a: Any, v: Any) -> int:
    arr = _as_array(a)
    val = float(v)
    lo, hi = 0, arr.size
    while lo < hi:
        mid = (lo + hi) // 2
        if float(arr._data[mid]) < val:
            lo = mid + 1
        else:
            hi = mid
    return lo


def concatenate(arrays: Sequence[ndarray], axis: int = 0) -> ndarray:
    if not arrays:
        raise ValueError("need at least one array to concatenate")
    ax = axis if axis >= 0 else arrays[0].ndim + axis
    if ax == 0:
        shape0 = arrays[0].shape[1:]
        data: List[Any] = []
        total0 = 0
        for arr in arrays:
            data.extend(arr._data)
            total0 += arr.shape[0]
        return ndarray(data, (total0,) + shape0, arrays[0].dtype)

    ndim = arrays[0].ndim
    new_axis_len = _bi.sum(arr.shape[ax] for arr in arrays)
    out_shape = tuple(new_axis_len if d == ax else arrays[0].shape[d] for d in range(ndim))
    st_out = _strides(out_shape)
    out_data = [0.0] * _prod(out_shape)
    offset = 0
    for arr in arrays:
        st_in = _strides(arr.shape)
        ax_len = arr.shape[ax]
        for idx, val in enumerate(arr._data):
            rem = idx
            out_idx = 0
            for d in range(ndim):
                coord = rem // st_in[d]
                rem %= st_in[d]
                if d == ax:
                    coord += offset
                out_idx += coord * st_out[d]
            out_data[out_idx] = val
        offset += ax_len
    return ndarray(out_data, out_shape, arrays[0].dtype)


def stack(arrays: Sequence[ndarray], axis: int = 0) -> ndarray:
    if axis != 0:
        raise NotImplementedError("np_compat.stack currently handles axis=0")
    shape0 = arrays[0].shape
    data: List[Any] = []
    for arr in arrays:
        data.extend(arr._data)
    return ndarray(data, (len(arrays),) + shape0, arrays[0].dtype)


class _AddUfunc:
    def __call__(self, a: Any, b: Any) -> ndarray:
        return _binary_op(a, b, _op.add)

    @staticmethod
    def at(a: ndarray, indices: Any, b: Any) -> None:
        idx_arr = indices if isinstance(indices, ndarray) else array(indices, dtype=int64)
        b_arr = b if isinstance(b, ndarray) else array(b, dtype=a.dtype)
        row_sz = _prod(a.shape[1:])
        for i, tok_id in enumerate(idx_arr._data):
            t_idx = int(tok_id)
            if t_idx < 0:
                t_idx += a.shape[0]
            a_off = t_idx * row_sz
            b_off = i * row_sz
            for j in range(row_sz):
                a._data[a_off + j] += b_arr._data[b_off + j]


add = _AddUfunc()


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

    def integers(self, low: int, high: Optional[int] = None, size: Optional[Union[int, Tuple[int, ...]]] = None) -> Any:
        if high is None:
            low, high = 0, low
        if size is None:
            return self._rng.randrange(low, high)
        shape = (size,) if isinstance(size, int) else tuple(size)
        return ndarray([self._rng.randrange(low, high) for _ in range(_prod(shape))], shape, int64)

    def choice(self, a: Union[int, Sequence[Any], ndarray], size: Optional[int] = None, replace: bool = True, p: Optional[Any] = None) -> Any:
        if isinstance(a, int):
            pop = list(range(a))
        elif isinstance(a, ndarray):
            pop = list(a._data)
        else:
            pop = list(a)
        weights = list(p._data if isinstance(p, ndarray) else p) if p is not None else None
        if size is None:
            if weights is not None:
                return self._rng.choices(pop, weights=weights, k=1)[0]
            return self._rng.choice(pop)
        if replace:
            if weights is not None:
                chosen = self._rng.choices(pop, weights=weights, k=size)
            else:
                chosen = [self._rng.choice(pop) for _ in range(size)]
        else:
            chosen = self._rng.sample(pop, size)
        dt = int64 if _bi.all(_is_int_like(v) for v in chosen) else float64
        return ndarray(chosen, (size,), dt)


class _RandomModule:
    def __init__(self):
        self._global_rng = _CompatRNG(42)

    def seed(self, seed: Optional[int] = None) -> None:
        self._global_rng = _CompatRNG(seed)

    def default_rng(self, seed: Optional[int] = None) -> _CompatRNG:
        return _CompatRNG(seed)

    def randn(self, *dims: int) -> Any:
        if not dims:
            return self._global_rng.normal(0.0, 1.0)
        return self._global_rng.normal(0.0, 1.0, size=dims)

    def randint(self, low: int, high: Optional[int] = None, size: Optional[Union[int, Tuple[int, ...]]] = None) -> Any:
        return self._global_rng.integers(low, high=high, size=size)


random = _RandomModule()


def default_rng(seed: Optional[int] = None) -> _CompatRNG:
    return _CompatRNG(seed)
