/**
 * ZYNTHEOR Sovereign High-Performance Float64 Matrix Multiplication
 * Validated typed-array implementation with dimension & finite-value assertions.
 */

function assertValidMatrix(data, rows, cols, name) {
  if (!(data instanceof Float64Array)) {
    throw new TypeError(`${name} must be a Float64Array`);
  }
  if (!Number.isInteger(rows) || rows <= 0 || !Number.isInteger(cols) || cols <= 0) {
    throw new RangeError(`${name} dimensions must be positive integers`);
  }
  if (data.length !== rows * cols) {
    throw new RangeError(`${name} length ${data.length} does not match ${rows}x${cols}`);
  }
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i])) {
      throw new RangeError(`${name}[${i}] is not finite`);
    }
  }
}

function multiplyFloat64Matrices(A, rowsA, colsA, B, rowsB, colsB) {
  assertValidMatrix(A, rowsA, colsA, 'MatrixA');
  assertValidMatrix(B, rowsB, colsB, 'MatrixB');
  if (colsA !== rowsB) {
    throw new RangeError(`Dimension mismatch: colsA (${colsA}) !== rowsB (${rowsB})`);
  }

  const C = new Float64Array(rowsA * colsB);
  // Cache-friendly i-k-j loop order
  for (let i = 0; i < rowsA; i++) {
    const rowOffsetA = i * colsA;
    const rowOffsetC = i * colsB;
    for (let k = 0; k < colsA; k++) {
      const a_ik = A[rowOffsetA + k];
      const rowOffsetB = k * colsB;
      for (let j = 0; j < colsB; j++) {
        C[rowOffsetC + j] += a_ik * B[rowOffsetB + j];
      }
    }
  }
  return C;
}

// Self-verification: 2x2 test
const a = new Float64Array([1, 2, 3, 4]);
const b = new Float64Array([5, 6, 7, 8]);
const c = multiplyFloat64Matrices(a, 2, 2, b, 2, 2);
if (c[0] !== 19 || c[3] !== 50) {
  throw new Error(`Unexpected result: [${Array.from(c).join(', ')}]`);
}
console.log(JSON.stringify({ status: 'PASS', product_0_0: c[0], product_1_1: c[3] }));
