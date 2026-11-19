// Download quickLogs as .log - ใส่ในแถบเครื่องมือ Log
export function downloadQuickLogs(logs: string[] | string) {
  const text = Array.isArray(logs) ? logs.join("\n") : logs;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const blob = new Blob([text + "\n"], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `zyntheor-quicklogs-${stamp}.log`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ตัวอย่างปุ่ม - เอาไปวางใน Toolbar ของ Log:
// <button onClick={() => downloadQuickLogs(quickLogs)}>Download .log</button>
