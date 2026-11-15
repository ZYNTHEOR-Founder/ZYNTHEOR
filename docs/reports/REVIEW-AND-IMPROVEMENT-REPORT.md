
## NativeLM 41.53M API integration — 2026-11-13

เพิ่ม target generation path แยกจาก active runtime เดิม โดยโหลด `native_data/model_checkpoint_target_41m.pt` แบบ lazy ผ่าน `NativeLM.load()` ใน `NativeNeuralModel.generate_target()`

เพิ่ม JSON-RPC command `target_generate` ใน Python Bridge และ provider method `targetGenerate()` ใน Node. เพิ่ม endpoint `POST /api/native/target-generate` รับ `prompt`, `maxNewTokens`, `temperature`, `topK`, `repetitionPenalty`, `seed` และคืน `generatedText/response`, token counts, latency, training steps, validation perplexity และ checkpoint SHA-256

เชื่อม UI `ConversationalIntelligence` ให้ส่ง `model: target_41m` ผ่าน `/api/chat/message`; chat route ใช้ target generation และยังคงส่ง NDJSON `chunk`/`done` ให้ UI เดิม

Repetition penalty ใช้กับ token ที่ปรากฏแล้ว และ suppress filler IDs ตั้งแต่ `real_vocab_size` ขึ้นไป เพื่อไม่ให้ output สุ่มไปยัง `<tok_N>`; parameter range ถูก validate ใน Python และ Node

Verification: Python compile ผ่าน, TypeScript lint ผ่าน, Vite build ผ่าน, direct Bridge smoke test ผ่าน (`8 tokens`, latency ประมาณ 230 ms), `/api/native/target-generate` ผ่าน และ `/api/chat/message` UI path ผ่านแบบ NDJSON (`chunk` + `done`). Checkpoint ที่ตอบกลับคือ 41,527,808 params, training steps 10,000, SHA-256 `9165a3d7359e283a6dc42cfa34c9b341f1b510f0b26b305cbfe6c03a155aef7d`
