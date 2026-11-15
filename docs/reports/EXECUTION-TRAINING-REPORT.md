# Execution Training (Not Chatbot)

## Progress
| Round | Steps | Resumed | Val loss best |
|-------|-------|---------|---------------|
| 1 | 100 | no | 3.8145 |
| 2 | 300 | yes | **3.2033** |

Params: 502,912 · Corpus: 22 execution docs · Objective: `execution_not_chatbot`

```bash
python3 -m qplus_native.train_execution --steps 500
```
