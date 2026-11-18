import torch
import os

ckpt_path = "native_data/model_checkpoint_target_41m.pt"

if not os.path.exists(ckpt_path):
    print(f"Error: Not found {ckpt_path}")
    exit(1)

print(f"Loading checkpoint from {ckpt_path}...")
# เพิ่ม weights_only=False เพื่อรองรับ PyTorch เวอร์ชันใหม่
checkpoint = torch.load(ckpt_path, map_location="cpu", weights_only=False)

print("\n--- Checkpoint Structure ---")
if isinstance(checkpoint, dict):
    print("Keys available:", list(checkpoint.keys()))
    for k in ['step', 'epoch', 'loss', 'train_loss', 'val_loss']:
        if k in checkpoint:
            print(f"- {k}: {checkpoint[k]}")
    
    state_dict = checkpoint.get('model_state_dict', checkpoint.get('state_dict', checkpoint))
    if isinstance(state_dict, dict) and len(state_dict) > 0:
        total_params = sum(p.numel() for p in state_dict.values())
        print(f"Total parameters in state_dict: {total_params:,}")
else:
    print("Checkpoint format is direct state_dict or tensor.")

print("\n*Verification:* Checkpoint loaded and inspected successfully without corruption.")
