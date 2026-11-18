import pathlib

def test_qplus_native_folder_exists():
    assert pathlib.Path("qplus_native/__init__.py").exists()

def test_runtime_workflow_exists():
    assert pathlib.Path(".github/workflows/runtime-integrity.yml").exists()
