from qplus_native.corpus import build_corpus

text_data = build_corpus()
if not text_data:
    raise ValueError("FAIL_CLOSED: Dataset is empty or not found!")

print(f"[INFO] Loaded successfully! Total samples: {len(text_data)}")
