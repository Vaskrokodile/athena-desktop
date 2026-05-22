"""Wiki memory plugin using the MemoryProvider interface.

Provides local Markdown-based LLM Wiki long-term memory, interlinked via wikilinks,
with automatic keyword prefetch, background turn synthesis, and manual page edits.
"""

from __future__ import annotations

import json
import logging
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from agent.memory_provider import MemoryProvider
from tools.registry import tool_error

logger = logging.getLogger(__name__)

WIKI_QUERY_SCHEMA = {
    "name": "wiki_query",
    "description": "Query or search the LLM Wiki for concepts, entities, or log entries by keyword or name.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "The search keyword, term, or exact page name to search for."}
        },
        "required": ["query"]
    }
}

WIKI_UPDATE_SCHEMA = {
    "name": "wiki_update",
    "description": "Create or update a page in the LLM Wiki (e.g. concepts, entities, sources, or a root page).",
    "parameters": {
        "type": "object",
        "properties": {
            "page_name": {"type": "string", "description": "The title of the page (e.g., 'Agent Architecture' or 'log.md')."},
            "category": {"type": "string", "description": "Folder category: 'concepts', 'entities', 'sources', or empty for root.", "enum": ["concepts", "entities", "sources", ""]},
            "content": {"type": "string", "description": "The full markdown content of the page, including any [[wikilinks]]."},
            "metadata": {"type": "object", "description": "Optional key-value metadata to write as YAML frontmatter."}
        },
        "required": ["page_name", "content"]
    }
}

WIKI_LIST_SCHEMA = {
    "name": "wiki_list",
    "description": "List all pages in the LLM Wiki, including their category/subfolder and sizes.",
    "parameters": {
        "type": "object",
        "properties": {}
    }
}


class WikiMemoryProvider(MemoryProvider):
    def __init__(self):
        self._session_id = ""
        self._hermes_home = ""
        self.wiki_dir = Path()
        self._write_enabled = True
        self._sync_thread: Optional[threading.Thread] = None

    @property
    def name(self) -> str:
        return "wiki"

    def is_available(self) -> bool:
        # Since it is a local Markdown-based repository, it is always available.
        return True

    def get_config_schema(self) -> List[Dict[str, Any]]:
        # No remote configurations/credentials needed.
        return []

    def initialize(self, session_id: str, **kwargs) -> None:
        from hermes_constants import get_hermes_home
        self._hermes_home = kwargs.get("hermes_home") or str(get_hermes_home())
        self._session_id = session_id

        # Setup wiki paths
        self.wiki_dir = Path(self._hermes_home) / "wiki"
        self.wiki_dir.mkdir(parents=True, exist_ok=True)
        (self.wiki_dir / "concepts").mkdir(exist_ok=True)
        (self.wiki_dir / "entities").mkdir(exist_ok=True)
        (self.wiki_dir / "sources").mkdir(exist_ok=True)

        # Ensure log.md exists
        log_file = self.wiki_dir / "log.md"
        if not log_file.exists():
            try:
                log_file.write_text(
                    "# Chronological Activity Log\n\nThis log records agent learnings, updates, and major events over time.\n",
                    encoding="utf-8"
                )
            except Exception as e:
                logger.warning("Failed to create log.md: %s", e)

        agent_context = kwargs.get("agent_context", "")
        self._write_enabled = agent_context not in {"cron", "flush", "subagent"}
        logger.info("WikiMemoryProvider initialized at %s", self.wiki_dir)

    def system_prompt_block(self) -> str:
        return (
            "# LLM Wiki Memory System\n"
            "Active. The LLM Wiki is stored locally at $HERMES_HOME/wiki/. It is organized into:\n"
            "- concepts/ (general programming/domain knowledge, system preferences)\n"
            "- entities/ (people, projects, APIs, tools)\n"
            "- sources/ (references, papers, documentation)\n"
            "- log.md (chronological log of learnings, updates, and events)\n\n"
            "You have tools to read, update, and search this wiki: `wiki_query`, `wiki_update`, and `wiki_list`.\n"
            "Use [[wikilinks]] (e.g. [[My Page Name]]) inside markdown files to link pages.\n"
            "When a page is created/updated, keep its format clean with standard markdown and optional YAML frontmatter.\n"
            "Use these tools to query and update long term memory when relevant.\n"
        )

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        if not query or not query.strip():
            return ""

        # 1. Tokenize query
        words = re.findall(r"\b[a-zA-Z0-9_-]{3,}\b", query.lower())
        if not words:
            return ""

        # Stopwords to ignore
        stopwords = {
            "the", "and", "for", "with", "this", "that", "you", "your", "how", "what",
            "where", "when", "why", "who", "can", "new", "get", "run", "use", "make",
            "them", "their", "they", "from", "then", "will", "some"
        }
        search_words = [w for w in words if w not in stopwords]

        # 2. Find matching pages in subfolders & root
        matched_pages = []
        seen_paths = set()
        for category in ["concepts", "entities", "sources", ""]:
            cat_dir = self.wiki_dir / category if category else self.wiki_dir
            if not cat_dir.is_dir():
                continue
            for file in cat_dir.glob("*.md"):
                if file.is_dir() or file.name == "log.md":
                    continue
                name_lower = file.stem.lower()
                if any(word in name_lower for word in search_words):
                    if file not in seen_paths:
                        seen_paths.add(file)
                        matched_pages.append(file)
                        if len(matched_pages) >= 5:
                            break
            if len(matched_pages) >= 5:
                break

        # Also get a snippet of the log.md
        log_file = self.wiki_dir / "log.md"
        log_snippet = ""
        if log_file.exists():
            try:
                log_content = log_file.read_text(encoding="utf-8")
                lines = log_content.splitlines()
                if len(lines) > 20:
                    log_snippet = "\n".join(lines[-20:])
                else:
                    log_snippet = log_content
            except Exception:
                pass

        if not matched_pages and not log_snippet:
            return ""

        # Format matched pages
        blocks = []
        for file in matched_pages:
            try:
                content = file.read_text(encoding="utf-8")
                category_prefix = f"{file.parent.name}/" if file.parent != self.wiki_dir else ""
                blocks.append(f"### Page: {category_prefix}{file.name}\n\n{content}")
            except Exception:
                pass

        if log_snippet:
            blocks.append(f"### Page: log.md (Recent Entries)\n\n{log_snippet}")

        if not blocks:
            return ""

        body = "\n\n---\n\n".join(blocks)
        return f"<wiki-context>\n{body}\n</wiki-context>"

    def sync_turn(self, user_content: str, assistant_content: str, *, session_id: str = "") -> None:
        if not self._write_enabled:
            return

        def _run():
            try:
                self._background_sync(user_content, assistant_content)
            except Exception as e:
                logger.debug("WikiMemoryProvider: sync_turn failed", exc_info=True)

        if self._sync_thread and self._sync_thread.is_alive():
            self._sync_thread.join(timeout=2.0)
        self._sync_thread = threading.Thread(target=_run, daemon=True, name="wiki-sync")
        self._sync_thread.start()

    def _background_sync(self, user_content: str, assistant_content: str):
        extraction_prompt = f"""You are the background memory synthesis module for the Hermes/Athena Agent.
Your job is to analyze the latest conversation turn and determine if any long-term memory updates are needed in the LLM Wiki.

The LLM Wiki consists of:
- `concepts/` (general programming/domain knowledge, system preferences)
- `entities/` (people, projects, APIs, tools)
- `sources/` (references, papers, documentation)
- `log.md` (chronological log of learnings, updates, and events)

Analyze the following turn:
[User]:
{user_content}

[Assistant]:
{assistant_content}

Determine if any facts, preferred patterns, setup configurations, or newly acquired learnings should be added to the Wiki.
Only extract lasting personal facts, preferences, routines, tools, ongoing projects, working context, or explicit requests to remember. Ignore one-off conversation details, transient state, or implementation status.

You can perform two types of actions:
1. Append a chronological entry to `log.md` (e.g. "- Completed implementation of dark mode" or "- Discovered that the backend API requires port 8000").
2. Create or update a specific concept/entity/source page (e.g. `concepts/Python Development.md` or `entities/Project Athena.md`).

Return your decisions in JSON format as follows:
{{
  "log_entry": "Optional text to append to log.md (bullet point starting with '- [YYYY-MM-DD] ...')",
  "wiki_pages": [
    {{
      "page_name": "Exact page name (without .md extension)",
      "category": "concepts" or "entities" or "sources",
      "content": "Full markdown content. If updating an existing page, write the COMPLETE, updated content. Include YAML frontmatter if appropriate, and use [[wikilinks]] to link to other pages."
    }}
  ]
}}

If no updates are needed, return an empty JSON object: {{}}

Return ONLY valid JSON. Do not include markdown code block styling or extra conversational text.
"""
        from agent.auxiliary_client import call_llm
        messages = [
            {"role": "user", "content": extraction_prompt}
        ]
        
        response = call_llm(messages=messages, task="memory", temperature=0.1)
        content = response.choices[0].message.content.strip()

        # Parse markdown wrapper code blocks if present
        if content.startswith("```"):
            lines = content.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            content = "\n".join(lines).strip()

        if not content or content == "{}":
            return

        try:
            data = json.loads(content)
        except Exception as parse_err:
            logger.debug("WikiMemoryProvider: failed to parse JSON extraction: %s", parse_err)
            return

        # 1. Update log.md
        log_entry = data.get("log_entry")
        if log_entry:
            log_file = self.wiki_dir / "log.md"
            current_log = ""
            if log_file.exists():
                current_log = log_file.read_text(encoding="utf-8")
            if not current_log.endswith("\n"):
                current_log += "\n"
            
            today_str = datetime.now().strftime("%Y-%m-%d")
            entry_line = log_entry.strip()
            if not entry_line.startswith("-"):
                entry_line = f"- {entry_line}"
            if f"[{today_str}]" not in entry_line and not re.match(r"^-\s*\[\d{4}-\d{2}-\d{2}\]", entry_line):
                entry_line = entry_line.replace("-", f"- [{today_str}]", 1)

            log_file.write_text(current_log + entry_line + "\n", encoding="utf-8")
            logger.info("WikiMemoryProvider: Appended to log.md: %s", entry_line)

        # 2. Update wiki pages
        wiki_pages = data.get("wiki_pages") or []
        for page in wiki_pages:
            pname = page.get("page_name")
            cat = page.get("category") or ""
            pcontent = page.get("content")
            if pname and pcontent:
                self.update_page(pname, cat, pcontent)
                logger.info("WikiMemoryProvider: Automatically updated wiki page %s/%s", cat, pname)

    def update_page(self, page_name: str, category: str, content: str, metadata: dict = None) -> None:
        category = category.strip().lower()
        if category not in ["concepts", "entities", "sources"]:
            category = ""

        # Make sure page_name ends with .md
        if not page_name.endswith(".md"):
            file_name = f"{page_name}.md"
        else:
            file_name = page_name

        file_name = Path(file_name).name  # prevent path traversal

        if category:
            target_dir = self.wiki_dir / category
        else:
            target_dir = self.wiki_dir

        target_dir.mkdir(parents=True, exist_ok=True)
        file_path = target_dir / file_name

        # Parse existing metadata if present
        clean_content = content
        existing_meta = {}
        match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
        if match:
            frontmatter_str = match.group(1)
            clean_content = content[match.end():]
            try:
                import yaml
                existing_meta = yaml.safe_load(frontmatter_str) or {}
            except Exception:
                pass

        if metadata:
            existing_meta.update(metadata)

        yaml_header = ""
        if existing_meta:
            try:
                import yaml
                yaml_header = "---\n" + yaml.safe_dump(existing_meta, default_flow_style=False).strip() + "\n---\n\n"
            except Exception:
                pass

        file_path.write_text(yaml_header + clean_content, encoding="utf-8")

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        return [WIKI_QUERY_SCHEMA, WIKI_UPDATE_SCHEMA, WIKI_LIST_SCHEMA]

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        if tool_name == "wiki_query":
            query = args.get("query", "").strip()
            results = []
            for file in self.wiki_dir.rglob("*.md"):
                if file.is_dir():
                    continue
                rel_path = file.relative_to(self.wiki_dir)
                try:
                    file_content = file.read_text(encoding="utf-8")
                    if query.lower() in file.name.lower() or query.lower() in file_content.lower():
                        snippet = file_content[:200] + ("..." if len(file_content) > 200 else "")
                        results.append({
                            "page_name": file.stem,
                            "category": str(rel_path.parent) if rel_path.parent != Path(".") else "",
                            "snippet": snippet
                        })
                except Exception:
                    pass
            return json.dumps({"results": results, "count": len(results)})

        if tool_name == "wiki_update":
            page_name = args.get("page_name", "").strip()
            category = args.get("category", "").strip()
            content = args.get("content", "").strip()
            metadata = args.get("metadata") or {}
            if not page_name or not content:
                return tool_error("page_name and content are required")
            try:
                self.update_page(page_name, category, content, metadata)
                return json.dumps({"success": True, "page": f"{category}/{page_name}" if category else page_name})
            except Exception as e:
                return tool_error(f"Failed to update page: {e}")

        if tool_name == "wiki_list":
            pages = []
            for file in self.wiki_dir.rglob("*.md"):
                if file.is_dir():
                    continue
                rel_path = file.relative_to(self.wiki_dir)
                category = str(rel_path.parent) if rel_path.parent != Path(".") else ""
                pages.append({
                    "page_name": file.stem,
                    "category": category,
                    "size": file.stat().st_size
                })
            return json.dumps({"pages": pages, "count": len(pages)})

        raise NotImplementedError(f"Provider {self.name} does not handle tool {tool_name}")

    def shutdown(self) -> None:
        if self._sync_thread and self._sync_thread.is_alive():
            self._sync_thread.join(timeout=5.0)
            self._sync_thread = None


def register(ctx):
    ctx.register_memory_provider(WikiMemoryProvider())
