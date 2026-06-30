"""
ThermIQ — Load Boiler Slice Graph into Neo4j Aura
===================================================

Reads data/graph_slices/boiler_slice.json and merges all nodes and
relationships into the Neo4j Aura instance configured in .env.

Idempotent: safe to run multiple times. MERGE on node id means
re-running will update properties but won't create duplicate nodes.

Usage (from project root):
    python scripts/load_graph_neo4j.py                       # default: boiler_slice.json
    python scripts/load_graph_neo4j.py turbine_slice.json    # load a different slice
    python scripts/load_graph_neo4j.py data/graph_slices/turbine_slice.json

A bare filename is resolved under data/graph_slices/. Loading is idempotent and
additive (MERGE on node id), so loading the turbine slice after the boiler slice
extends the same graph rather than replacing it.

Requires:
    pip install neo4j python-dotenv
"""

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# ── Load env ──────────────────────────────────────────────────────────────────
load_dotenv()

NEO4J_URI      = os.environ.get("NEO4J_URI")
NEO4J_USERNAME = os.environ.get("NEO4J_USERNAME")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD")
NEO4J_DATABASE = os.environ.get("NEO4J_DATABASE", "neo4j")

if not all([NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD]):
    print("ERROR: NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD missing from .env")
    sys.exit(1)

# ── Paths ─────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent.parent
SLICES_DIR   = PROJECT_ROOT / "data" / "graph_slices"


def resolve_slice_path(arg: str | None) -> Path:
    """Default to boiler_slice.json. A bare filename resolves under the slices dir;
    an absolute/relative path with separators is used as-is."""
    if not arg:
        return SLICES_DIR / "boiler_slice.json"
    p = Path(arg)
    if p.parent == Path("."):          # bare filename like "turbine_slice.json"
        return SLICES_DIR / p
    return p if p.is_absolute() else PROJECT_ROOT / p


SLICE_PATH = resolve_slice_path(sys.argv[1] if len(sys.argv) > 1 else None)

# ── Helpers ───────────────────────────────────────────────────────────────────

def props_clause(prefix: str, keys: list[str]) -> str:
    """Build a Cypher SET clause fragment like: n.key = $p_key, ..."""
    return ", ".join(f"{prefix}.{k} = ${prefix}_{k}" for k in keys)


def flat_props(prefix: str, node: dict, keys: list[str]) -> dict:
    """Return a dict suitable for passing as Cypher parameters."""
    return {f"{prefix}_{k}": node.get(k) for k in keys}


# ── Node loaders ──────────────────────────────────────────────────────────────

NODE_BASE_KEYS = ["label"]

PROCEDURE_EXTRA_KEYS = [
    "status", "criticality", "gap_id",
    "evidence_count", "is_gap",
]

OUTAGE_EXTRA_KEYS = [
    "station", "unit", "mw_lost", "date_out",
    "outage_hours", "revenue_lost_est_cr",
    "failure_reason_raw", "failure_category",
]


def load_node(tx, node: dict) -> None:
    ntype  = node["type"]   # Equipment | FailureMode | Procedure | Regulation | OutageEvent
    nid    = node["id"]

    if ntype == "Procedure":
        keys = NODE_BASE_KEYS + PROCEDURE_EXTRA_KEYS
    elif ntype == "OutageEvent":
        keys = NODE_BASE_KEYS + OUTAGE_EXTRA_KEYS
    else:
        keys = NODE_BASE_KEYS

    params = {"id": nid}
    params.update(flat_props("n", node, keys))

    set_parts = ["n.id = $id"] + [f"n.{k} = $n_{k}" for k in keys]
    set_clause = ", ".join(set_parts)

    query = f"""
MERGE (n:{ntype} {{id: $id}})
SET {set_clause}
"""
    tx.run(query, **params)


# ── Edge loaders ──────────────────────────────────────────────────────────────

ADDRESSED_BY_KEYS = ["status", "is_gap"]


def load_edge(tx, edge: dict) -> None:
    etype   = edge["type"]
    from_id = edge["from"]
    to_id   = edge["to"]

    params = {"from_id": from_id, "to_id": to_id}

    if etype == "ADDRESSED_BY":
        params.update(flat_props("e", edge, ADDRESSED_BY_KEYS))
        set_clause = ", ".join(f"e.{k} = $e_{k}" for k in ADDRESSED_BY_KEYS)
        query = f"""
MATCH (a {{id: $from_id}}), (b {{id: $to_id}})
MERGE (a)-[e:{etype}]->(b)
SET {set_clause}
"""
    else:
        query = f"""
MATCH (a {{id: $from_id}}), (b {{id: $to_id}})
MERGE (a)-[:{etype}]->(b)
"""

    tx.run(query, **params)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    try:
        from neo4j import GraphDatabase
    except ImportError:
        print("ERROR: neo4j driver not installed. Run: pip install neo4j")
        sys.exit(1)

    print(f"Loading graph slice from: {SLICE_PATH}")
    data = json.loads(SLICE_PATH.read_text(encoding="utf-8"))

    nodes = data["nodes"]
    edges = data["edges"]
    print(f"  {len(nodes)} nodes, {len(edges)} edges")

    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USERNAME, NEO4J_PASSWORD))

    try:
        driver.verify_connectivity()
        print(f"Connected to: {NEO4J_URI}")
    except Exception as exc:
        print(f"ERROR: Cannot connect to Neo4j — {exc}")
        sys.exit(1)

    with driver.session(database=NEO4J_DATABASE) as session:

        # 1. Create uniqueness constraints (idempotent — safe to re-run)
        print("Creating constraints...")
        for label in ["Equipment", "FailureMode", "Procedure", "Regulation", "OutageEvent"]:
            session.run(
                f"CREATE CONSTRAINT {label.lower()}_id IF NOT EXISTS "
                f"FOR (n:{label}) REQUIRE n.id IS UNIQUE"
            )

        # 2. Load nodes
        print("Loading nodes...")
        for node in nodes:
            session.execute_write(load_node, node)
            print(f"  ✓ {node['type']:14s}  {node['id']}")

        # 3. Load edges
        print("Loading edges...")
        for edge in edges:
            session.execute_write(load_edge, edge)
            print(f"  ✓ ({edge['from']}) --[{edge['type']}]--> ({edge['to']})")

    driver.close()

    print()
    print("─" * 60)
    print(f"  Graph loaded: {len(nodes)} nodes · {len(edges)} edges")
    print(f"  Database:     {NEO4J_DATABASE}")
    print("  Run hero_traversal.py next.")
    print("─" * 60)


if __name__ == "__main__":
    main()
