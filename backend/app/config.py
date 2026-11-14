import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


@dataclass(frozen=True)
class Settings:
    client_name: str = "spaetkauf-demo/0.1"
    db_path: Path = REPO_ROOT / "backend" / "var" / "app.sqlite"
    plan_budget: int = 700
    loop: bool = True
    exa_key: str = ""
    context_key: str = ""
    anthropic_key: str = ""
    adapt_daily_cap: int = 50

    @classmethod
    def from_env(cls) -> "Settings":
        _load_dotenv(REPO_ROOT / ".env")
        env = os.environ
        db = Path(env.get("SPAETKAUF_DB_PATH") or cls.db_path)
        if not db.is_absolute():
            db = REPO_ROOT / db
        return cls(
            client_name=env.get("SPAETKAUF_CLIENT_NAME") or cls.client_name,
            db_path=db,
            plan_budget=int(env.get("SPAETKAUF_PLAN_BUDGET") or cls.plan_budget),
            loop=env.get("SPAETKAUF_LOOP", "1") != "0",
            exa_key=env.get("EXA_API_KEY", ""),
            context_key=env.get("CONTEXT_API_KEY", ""),
            anthropic_key=env.get("ANTHROPIC_API_KEY", ""),
            adapt_daily_cap=int(env.get("SPAETKAUF_ADAPT_DAILY_CAP") or cls.adapt_daily_cap),
        )
