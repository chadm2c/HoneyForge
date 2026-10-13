import sys
from pathlib import Path

# Make the decoy module importable however pytest is invoked.
sys.path.insert(0, str(Path(__file__).resolve().parent))
