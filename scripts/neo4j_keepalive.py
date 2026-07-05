"""
ThermIQ — Neo4j Aura Keep-Alive
=================================

AuraDB Free instances auto-pause after 72 hours of inactivity (and are
permanently deleted after 90 days paused — see task-035/039 in BRIDGE.md,
where the instance briefly looked "deleted" and turned out to be paused).
This script runs one trivial read query so the instance always sees
activity well inside that 72-hour window.

Run daily by .github/workflows/neo4j-keepalive.yml. Exits non-zero on any
connection failure so the workflow run shows red and YC gets a GitHub
notification instead of this silently failing for weeks.

Usage (from project root):
    python scripts/neo4j_keepalive.py

Requires:
    pip install neo4j python-dotenv
"""

import os
import sys

from dotenv import load_dotenv
from neo4j import GraphDatabase

load_dotenv()

NEO4J_URI      = os.environ.get("NEO4J_URI")
NEO4J_USERNAME = os.environ.get("NEO4J_USERNAME")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD")
NEO4J_DATABASE = os.environ.get("NEO4J_DATABASE", "neo4j")


def main():
    if not all([NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD]):
        print("ERROR: NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD missing from environment.")
        sys.exit(1)

    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USERNAME, NEO4J_PASSWORD))
    try:
        with driver.session(database=NEO4J_DATABASE) as session:
            result = session.run(
                "MATCH (n) RETURN count(n) AS node_count LIMIT 1"
            )
            record = result.single()
            node_count = record["node_count"] if record else 0
            print(f"Neo4j Aura keep-alive OK — {node_count} nodes visible, instance is awake.")
    except Exception as e:
        print(f"ERROR: keep-alive query failed — {e}")
        sys.exit(1)
    finally:
        driver.close()


if __name__ == "__main__":
    main()
