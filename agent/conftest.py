import sys
from pathlib import Path

# Make the agent package importable regardless of how pytest is invoked
# (bare `pytest`, `python -m pytest`, or inside the container).
sys.path.insert(0, str(Path(__file__).resolve().parent))