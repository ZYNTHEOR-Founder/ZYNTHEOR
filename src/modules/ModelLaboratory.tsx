import React, { useState } from 'react';

const EXPECTED_PARAMS = 41_527_808;
// ในระบบจริงค่านี้ต้องดึงมาจาก Provenance Manifest
const EXPECTED_SHA256 = "58614a6a9f5c5069...";

export function ModelLaboratory() {
  const [weightsVerified, setWeightsVerified] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("IDLE");
  const [error, setError] = useState<string | null>(null);

  const verifyAndLoadModel = async (buffer: ArrayBuffer) => {
    setStatus("VERIFYING");
    setError(null);

    try {
      // 1. Calculate SHA-256 Hash (Zero-Fake check)
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      if (hashHex !== EXPECTED_SHA256) {
        throw new Error(`SHA-256 mismatch. Expected ${EXPECTED_SHA256}, got ${hashHex}`);
      }

      // 2. Extract Parameter Count (จำลองการอ่าน Header)
      // ในระบบจริงต้องใช้ ZYNTHEOR_QPLUS_PTV parser ในการอ่าน Metadata
      const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer.slice(0, 500))));
      const actualParams = metadata.total_params;

      // 3. Strict Parameter Validation
      if (actualParams !== EXPECTED_PARAMS) {
        throw new Error(`Parameter mismatch. Expected ${EXPECTED_PARAMS}, got ${actualParams}`);
      }

      // 4. Mark as verified ONLY if all checks pass
      setWeightsVerified(true);
      setStatus("VERIFIED_AND_LOADED");
      
    } catch (err: any) {
      setWeightsVerified(false);
      setStatus("FAILED");
      setError(err.message);
    }
  };

  return (
    <div className="p-4 border border-gray-700 rounded-lg">
      <h2 className="text-xl font-bold mb-4">Model Laboratory - 41.5M Verifier</h2>
      
      {/* UI แสดงสถานะ */}
      <div className="mb-4">
        <span className="font-mono">Status: {status}</span>
        {weightsVerified && <span className="ml-2 text-green-400">✓ Weights Verified</span>}
        {error && <p className="text-red-400 mt-2 text-sm">{error}</p>}
      </div>

      <button 
        disabled={status === "VERIFYING"}
        className="bg-blue-600 px-4 py-2 rounded hover:bg-blue-500 disabled:opacity-50"
        onClick={() => {
          // จำลองการโหลด Buffer จาก Cloud
          // ในระบบจริงต้องใช้ fetch() จาก Presigned URL
        }}
      >
        Fetch & Verify 41.5M Checkpoint
      </button>
    </div>
  );
                                                                 }
