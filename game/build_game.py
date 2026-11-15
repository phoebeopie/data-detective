"""Builds docs/index.html — the D² Detective game, self-contained (game_src.html + game_logic.js + stats.js + land.json) from game_src.html + ../docs/stats.js + land.json."""
from pathlib import Path
here = Path(__file__).parent
src = (here / "game_src.html").read_text()
stats = (here.parent / "docs" / "stats.js").read_text()
land = (here / "land.json").read_text()
logic = (here / "game_logic.js").read_text()
out = src.replace("/*@@STATS@@*/", stats).replace("/*@@LAND@@*/", land).replace("/*@@LOGIC@@*/", logic)
(here.parent / "docs" / "index.html").write_text(out)
print("wrote docs/index.html", len(out)//1024, "KB")
