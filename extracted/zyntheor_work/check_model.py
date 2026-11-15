import sys, numpy as np
sys.path.append('.')
from qplus_native.lm_v2 import NativeLM

print("⏳ กำลังโหลดโมเดล...")
model_wrapper = NativeLM.load('native_data/model_checkpoint_target_41m.pt')[0]
p = getattr(model_wrapper, 'p', None)

total_params = 0
if p is not None:
    items = p.values() if isinstance(p, dict) else (p if isinstance(p, (list, tuple)) else [p])
    for v in items:
        total_params += v.size if hasattr(v, 'size') else int(np.prod(v.shape))
        
print(f"✅ โหลดสำเร็จ! จำนวนพารามิเตอร์: {total_params:,} ตัว")
print(f"📦 ประเภทข้อมูล: {type(p)}")
