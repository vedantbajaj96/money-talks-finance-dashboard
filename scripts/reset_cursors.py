"""Reset Plaid cursors for a user to force a full resync on next sync."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.plaid_client import _load_items, _save_items
from core.store import user_dir

username = sys.argv[1] if len(sys.argv) > 1 else "vedant"
data_dir = str(user_dir(username))
items = _load_items(data_dir=data_dir)
for item in items:
    cursor = item.get("cursor")
    print(f"  {item.get('institution_name')}: cursor={'set' if cursor else 'None'} → resetting")
    item["cursor"] = None
_save_items(items, data_dir)
print("Cursors reset. Next sync will be a full resync.")
