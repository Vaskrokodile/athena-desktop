import { useEffect, useLayoutEffect, useState, useRef, useMemo } from "react";
import {
  BookOpen,
  Edit2,
  Trash2,
  Plus,
  Search,
  Save,
  X,
  FileText,
  Network,
  ChevronRight,
  ChevronDown,
  Tag,
  AlertCircle,
  Sparkles,
  RefreshCw,
  Folder,
} from "lucide-react";
import { api } from "@/lib/api";
import type { WikiPageSummary, WikiPageDetail, WikiGraphNode, WikiGraphLink } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { Toast } from "@/components/Toast";
import { Button } from "@nous-research/ui/ui/components/button";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { usePageHeader } from "@/contexts/usePageHeader";
import { Markdown } from "@/components/Markdown";

interface SimNode extends WikiGraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export default function WikiPage() {
  const { toast, showToast } = useToast();
  const { setAfterTitle, setEnd } = usePageHeader();

  // Page selection and list states
  const [pages, setPages] = useState<WikiPageSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedPageName, setSelectedPageName] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  
  // Selected page detail states
  const [selectedPage, setSelectedPage] = useState<WikiPageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  
  // Search query
  const [searchQuery, setSearchQuery] = useState("");
  
  // Expanded sidebar folders
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    concepts: true,
    entities: true,
    sources: true,
    root: true,
  });

  // View modes: "doc" or "graph"
  const [viewMode, setViewMode] = useState<"doc" | "graph">("doc");

  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editTags, setEditTags] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Custom modals/dialogs state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPageName, setNewPageName] = useState("");
  const [newPageCategory, setNewPageCategory] = useState("");

  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    | { type: "selectPage"; pageName: string; category: string }
    | { type: "toggleView"; mode: "doc" | "graph" }
    | { type: "createPage" }
    | null
  >(null);

  // Graph Data
  const [graphData, setGraphData] = useState<{ nodes: WikiGraphNode[]; links: WikiGraphLink[] } | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);

  // Physics simulation references & ticks
  const [tick, setTick] = useState(0);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<WikiGraphLink[]>([]);
  const draggedNodeIdRef = useRef<string | null>(null);
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Graph Pan / Zoom state
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // 1. Fetch pages on mount
  const fetchPagesList = async (selectNameAfter?: string, selectCatAfter?: string) => {
    try {
      setLoadingList(true);
      const res = await api.getWikiPages();
      setPages(res.pages);
      
      // Auto select first page or the selected page if it exists
      if (res.pages.length > 0) {
        if (selectNameAfter !== undefined) {
          if (selectNameAfter) {
            handleSelectPage(selectNameAfter, selectCatAfter || "");
          }
        } else if (!selectedPageName) {
          // Default to log.md or first page
          const logPage = res.pages.find(p => p.page_name === "log" && p.category === "");
          if (logPage) {
            handleSelectPage("log", "");
          } else {
            handleSelectPage(res.pages[0].page_name, res.pages[0].category);
          }
        }
      }
    } catch {
      showToast("Failed to fetch wiki pages list", "error");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    fetchPagesList();
  }, []);

  // 2. Fetch page detail when selection changes
  const fetchPageDetail = async (pageName: string, category: string) => {
    setLoadingDetail(true);
    try {
      const detail = await api.getWikiPage(pageName, category);
      setSelectedPage(detail);
      setEditContent(detail.content);
      setEditTitle(detail.metadata.title || detail.page_name);
      setEditTags(Array.isArray(detail.metadata.tags) ? detail.metadata.tags.join(", ") : "");
      setIsEditing(false);
      setIsDirty(false);
    } catch (e: any) {
      showToast(e.message || "Failed to load wiki page content", "error");
    } finally {
      setLoadingDetail(false);
    }
  };

  // 3. Fetch Graph Data
  const fetchGraphData = async () => {
    setLoadingGraph(true);
    try {
      const data = await api.getWikiGraph();
      setGraphData(data);
    } catch {
      showToast("Failed to load knowledge graph data", "error");
    } finally {
      setLoadingGraph(false);
    }
  };

  useEffect(() => {
    if (viewMode === "graph") {
      fetchGraphData();
    }
  }, [viewMode]);

  // Dirty check navigation handler
  const handleSelectPage = (pageName: string, category: string) => {
    if (isDirty) {
      setPendingAction({ type: "selectPage", pageName, category });
      setShowUnsavedConfirm(true);
    } else {
      setSelectedPageName(pageName);
      setSelectedCategory(category);
      fetchPageDetail(pageName, category);
    }
  };

  const handleToggleViewMode = (mode: "doc" | "graph") => {
    if (isDirty) {
      setPendingAction({ type: "toggleView", mode });
      setShowUnsavedConfirm(true);
    } else {
      setViewMode(mode);
    }
  };

  const handleCreateNewPageBtn = () => {
    if (isDirty) {
      setPendingAction({ type: "createPage" });
      setShowUnsavedConfirm(true);
    } else {
      setNewPageName("");
      setNewPageCategory("concepts");
      setShowCreateModal(true);
    }
  };

  // Confirm discard changes
  const handleConfirmDiscard = () => {
    setShowUnsavedConfirm(false);
    setIsDirty(false);
    setIsEditing(false);
    if (!pendingAction) return;

    if (pendingAction.type === "selectPage") {
      setSelectedPageName(pendingAction.pageName);
      setSelectedCategory(pendingAction.category);
      fetchPageDetail(pendingAction.pageName, pendingAction.category);
    } else if (pendingAction.type === "toggleView") {
      setViewMode(pendingAction.mode);
    } else if (pendingAction.type === "createPage") {
      setNewPageName("");
      setNewPageCategory("concepts");
      setShowCreateModal(true);
    }
    setPendingAction(null);
  };

  // Create page execution
  const handleCreatePageSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newPageName.trim()) {
      showToast("Page name is required", "error");
      return;
    }

    const cleanName = newPageName.trim().replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-]/g, "");
    if (!cleanName) {
      showToast("Invalid characters in page name", "error");
      return;
    }

    const exists = pages.some(p => p.page_name.toLowerCase() === cleanName.toLowerCase() && p.category === newPageCategory);
    if (exists) {
      showToast("A page with this name already exists in this category", "error");
      return;
    }

    setIsSaving(true);
    try {
      await api.saveWikiPage({
        page_name: cleanName,
        category: newPageCategory,
        content: `# ${newPageName.trim()}\n\nEnter content here...`,
        metadata: {
          title: newPageName.trim(),
          tags: [],
        },
      });
      showToast(`Created page "${newPageName.trim()}"`, "success");
      setShowCreateModal(false);
      // Refresh list and select the new page
      await fetchPagesList(cleanName, newPageCategory);
      setViewMode("doc");
    } catch (err: any) {
      showToast(err.message || "Failed to create page", "error");
    } finally {
      setIsSaving(false);
    }
  };

  // Save page details
  const handleSavePage = async () => {
    if (!selectedPageName) return;
    setIsSaving(true);
    try {
      const tagsArray = editTags
        .split(",")
        .map(t => t.trim())
        .filter(Boolean);

      await api.saveWikiPage({
        page_name: selectedPageName,
        category: selectedCategory || "",
        content: editContent,
        metadata: {
          title: editTitle,
          tags: tagsArray,
        },
      });

      showToast("Wiki page saved successfully", "success");
      setIsDirty(false);
      setIsEditing(false);
      // Reload lists and details
      fetchPagesList(selectedPageName, selectedCategory || "");
    } catch (err: any) {
      showToast(err.message || "Failed to save page", "error");
    } finally {
      setIsSaving(false);
    }
  };

  // Delete page
  const handleDeletePage = async () => {
    if (!selectedPageName) return;
    if (!confirm(`Are you sure you want to delete the wiki page "${editTitle || selectedPageName}"? This cannot be undone.`)) {
      return;
    }

    try {
      await api.deleteWikiPage(selectedPageName, selectedCategory || "");
      showToast("Page deleted successfully", "success");
      setSelectedPageName(null);
      setSelectedPage(null);
      fetchPagesList("", "");
    } catch (err: any) {
      showToast(err.message || "Failed to delete page", "error");
    }
  };

  // Toggle sidebar folder
  const toggleFolder = (folder: string) => {
    setExpandedFolders(prev => ({
      ...prev,
      [folder]: !prev[folder],
    }));
  };

  // Intercept wikilinks processed to wiki:// format
  const processedMarkdownContent = useMemo(() => {
    if (!selectedPage?.content) return "";
    return selectedPage.content.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, targetPage, label) => {
      const cleanTarget = targetPage.trim();
      const cleanLabel = (label || targetPage).trim();
      return `[${cleanLabel}](wiki://${cleanTarget})`;
    });
  }, [selectedPage?.content]);

  const handleWikiContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest("a");
    if (anchor) {
      const href = anchor.getAttribute("href");
      if (href && href.startsWith("wiki://")) {
        e.preventDefault();
        const pageName = decodeURIComponent(href.slice(7));
        
        // Find existing page
        const found = pages.find(p => p.page_name.toLowerCase() === pageName.toLowerCase());
        if (found) {
          handleSelectPage(found.page_name, found.category);
        } else {
          // Offer to create stub note
          if (confirm(`Wiki page "${pageName}" does not exist. Would you like to create it?`)) {
            setNewPageName(pageName);
            setNewPageCategory("concepts");
            setShowCreateModal(true);
          }
        }
      }
    }
  };

  // Filtered sidebar pages
  const filteredPages = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return pages;
    return pages.filter(
      p =>
        p.page_name.toLowerCase().includes(query) ||
        p.title.toLowerCase().includes(query) ||
        p.tags.some(t => t.toLowerCase().includes(query))
    );
  }, [pages, searchQuery]);

  const categorizedPages = useMemo(() => {
    const categories: Record<string, WikiPageSummary[]> = {
      concepts: [],
      entities: [],
      sources: [],
      root: [],
    };
    for (const p of filteredPages) {
      if (p.category === "concepts") categories.concepts.push(p);
      else if (p.category === "entities") categories.entities.push(p);
      else if (p.category === "sources") categories.sources.push(p);
      else categories.root.push(p);
    }
    return categories;
  }, [filteredPages]);

  // Set page headers
  useLayoutEffect(() => {
    setAfterTitle(
      <div className="flex items-center gap-1.5 ml-2">
        <span className="h-4 w-px bg-white/10" />
        <span className="text-xs font-mono text-cyan-400/80 tracking-wide uppercase">LLM Wiki Memory</span>
      </div>
    );
    setEnd(
      <div className="flex items-center gap-2">
        <div className="flex rounded-md border border-white/10 bg-slate-950/40 p-0.5">
          <Button
            size="xs"
            ghost={viewMode !== "doc"}
            className={cn(
              "h-7 px-3 text-xs font-medium rounded-sm border-0",
              viewMode === "doc" ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => handleToggleViewMode("doc")}
          >
            <FileText className="mr-1.5 size-3.5" />
            Document
          </Button>
          <Button
            size="xs"
            ghost={viewMode !== "graph"}
            className={cn(
              "h-7 px-3 text-xs font-medium rounded-sm border-0",
              viewMode === "graph" ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => handleToggleViewMode("graph")}
          >
            <Network className="mr-1.5 size-3.5" />
            Knowledge Graph
          </Button>
        </div>
        
        <Button
          size="xs"
          className="h-8 bg-cyan-600 hover:bg-cyan-500 text-white rounded-none border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.15)]"
          onClick={handleCreateNewPageBtn}
        >
          <Plus className="mr-1.5 size-4" />
          New Note
        </Button>
      </div>
    );
    return () => {
      setAfterTitle(null);
      setEnd(null);
    };
  }, [viewMode, setAfterTitle, setEnd, pages, isDirty]);

  // ---------------------------------------------------------------------------
  // Force-Directed Graph Simulation Logic
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!graphData) return;

    // Initialize nodes positions in nodesRef
    const initialized = graphData.nodes.map((n, i) => {
      const existing = nodesRef.current.find(en => en.id === n.id);
      if (existing) return { ...n, ...existing }; // Keep position/velocity if already exists

      // Spawn in a circle around center
      const angle = (i / graphData.nodes.length) * 2 * Math.PI;
      const radius = 90 + Math.random() * 50;
      return {
        ...n,
        x: 400 + radius * Math.cos(angle),
        y: 250 + radius * Math.sin(angle),
        vx: 0,
        vy: 0,
      };
    });

    nodesRef.current = initialized;
    linksRef.current = graphData.links;
  }, [graphData]);

  useEffect(() => {
    if (viewMode !== "graph") return;

    let animId: number;

    const step = () => {
      const nodes = nodesRef.current;
      const links = linksRef.current;
      const draggedId = draggedNodeIdRef.current;

      if (nodes.length > 0) {
        const cx = 400;
        const cy = 250;
        const friction = 0.84;
        const repulse = 1800; // Repulsion constant
        const spring = 0.045; // Spring force constant
        const linkDist = 95;  // Ideal distance
        const centerForce = 0.015; // Gravity to center

        const nodeMap = new Map(nodes.map(n => [n.id, n]));

        // 1. Pairwise Repulsion (Coulomb force)
        for (let i = 0; i < nodes.length; i++) {
          const u = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const v = nodes[j];
            const dx = v.x - u.x;
            const dy = v.y - u.y;
            const distSq = dx * dx + dy * dy || 1;
            const dist = Math.sqrt(distSq);

            const force = repulse / distSq;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            if (u.id !== draggedId) {
              u.vx -= fx;
              u.vy -= fy;
            }
            if (v.id !== draggedId) {
              v.vx += fx;
              v.vy += fy;
            }
          }
        }

        // 2. Link Spring Forces (Hooke's law)
        for (const link of links) {
          const u = nodeMap.get(link.source);
          const v = nodeMap.get(link.target);
          if (!u || !v) continue;

          const dx = v.x - u.x;
          const dy = v.y - u.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;

          const displacement = dist - linkDist;
          const force = displacement * spring;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          if (u.id !== draggedId) {
            u.vx += fx;
            u.vy += fy;
          }
          if (v.id !== draggedId) {
            v.vx -= fx;
            v.vy -= fy;
          }
        }

        // 3. Update Positions & apply friction / centering
        for (const node of nodes) {
          if (node.id === draggedId) {
            if (mousePosRef.current) {
              node.x = mousePosRef.current.x;
              node.y = mousePosRef.current.y;
              node.vx = 0;
              node.vy = 0;
            }
            continue;
          }

          // Central attraction force
          node.vx += (cx - node.x) * centerForce;
          node.vy += (cy - node.y) * centerForce;

          // Apply velocity decay (friction)
          node.vx *= friction;
          node.vy *= friction;

          // Update position
          node.x += node.vx;
          node.y += node.vy;

          // Clamp within boundaries to prevent escaping
          node.x = Math.max(15, Math.min(785, node.x));
          node.y = Math.max(15, Math.min(485, node.y));
        }

        setTick(t => t + 1);
      }
      animId = requestAnimationFrame(step);
    };

    animId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animId);
  }, [viewMode, graphData]);

  // Graph mouse handlers
  const handleNodeMouseDown = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    draggedNodeIdRef.current = nodeId;
    
    // Set mouse coordinates in SVG viewport space
    const svg = (e.currentTarget as HTMLElement).closest("svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    mousePosRef.current = {
      x: (mouseX - pan.x) / zoom,
      y: (mouseY - pan.y) / zoom,
    };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (draggedNodeIdRef.current) return;
    setIsPanning(true);
    panStart.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (draggedNodeIdRef.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      mousePosRef.current = {
        x: (mouseX - pan.x) / zoom,
        y: (mouseY - pan.y) / zoom,
      };
    } else if (isPanning) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setPan({
        x: panStart.current.panX + dx,
        y: panStart.current.panY + dy,
      });
    }
  };

  const handleMouseUp = () => {
    draggedNodeIdRef.current = null;
    setIsPanning(false);
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const scaleFactor = 1.05;
    const nextZoom = e.deltaY < 0 ? zoom * scaleFactor : zoom / scaleFactor;
    // Limit zoom range
    setZoom(Math.max(0.3, Math.min(4, nextZoom)));
  };

  const handleNodeClick = (node: SimNode, e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === "stub") {
      if (confirm(`Wiki page "${node.id}" does not exist. Would you like to create it now?`)) {
        setNewPageName(node.id);
        setNewPageCategory("concepts");
        setShowCreateModal(true);
      }
    } else {
      // Find category of the existing node
      const matchingPage = pages.find(p => p.page_name === node.id);
      handleSelectPage(node.id, matchingPage?.category || "");
      setViewMode("doc");
    }
  };

  const resetPanZoom = () => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };

  // Node Color Resolver
  const getNodeColor = (node: WikiGraphNode) => {
    if (node.type === "stub") return "#475569"; // Slate gray for stubs
    switch (node.category) {
      case "concepts":
        return "#06b6d4"; // Cyan
      case "entities":
        return "#a855f7"; // Purple
      case "sources":
        return "#f97316"; // Orange
      default:
        return "#10b981"; // Emerald
    }
  };

  return (
    <div className="flex flex-1 w-full min-w-0 min-h-0 bg-slate-950/20 overflow-hidden relative border border-white/5 shadow-[0_4px_30px_rgba(0,0,0,0.4)]">
      {/* Sidebar Panel */}
      <div className="w-64 md:w-72 shrink-0 border-r border-white/5 bg-slate-900/30 flex flex-col min-h-0">
        {/* Sidebar Search */}
        <div className="p-3.5 border-b border-white/5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="h-8 rounded-none border border-white/10 bg-slate-950/50 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-cyan-500/50"
              placeholder="Search note files or tags..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
                onClick={() => setSearchQuery("")}
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </div>

        {/* Sidebar Navigation Pages */}
        <div className="flex-1 overflow-y-auto p-2 space-y-3 font-sans select-none">
          {loadingList ? (
            <div className="py-8 flex justify-center">
              <Spinner className="size-5 text-cyan-400" />
            </div>
          ) : pages.length === 0 ? (
            <div className="py-8 px-4 text-center text-xs text-muted-foreground">
              No notes found. Click &quot;New Note&quot; to begin.
            </div>
          ) : (
            <>
              {/* Render each folder category */}
              {(["concepts", "entities", "sources", "root"] as const).map(catKey => {
                const list = categorizedPages[catKey];
                const label = catKey === "root" ? "Uncategorized" : catKey.charAt(0).toUpperCase() + catKey.slice(1);
                const isExpanded = expandedFolders[catKey];
                
                // Skip rendering empty folders when searching
                if (searchQuery && list.length === 0) return null;

                return (
                  <div key={catKey} className="space-y-0.5">
                    <div
                      className="flex items-center justify-between px-2 py-1.5 rounded-sm hover:bg-white/5 cursor-pointer text-xs font-semibold text-muted-foreground transition-colors group"
                      onClick={() => toggleFolder(catKey)}
                    >
                      <div className="flex items-center gap-1.5">
                        <Folder className="size-3.5 text-cyan-400/70" />
                        <span>{label}</span>
                        <span className="text-[10px] bg-white/5 px-1 py-0.2 rounded-full font-mono text-muted-foreground/80 group-hover:bg-cyan-500/10 group-hover:text-cyan-400">
                          {list.length}
                        </span>
                      </div>
                      {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </div>

                    {isExpanded && (
                      <div className="pl-3.5 space-y-0.5 border-l border-white/5 ml-3.5">
                        {list.length === 0 ? (
                          <div className="py-1.5 px-2 text-[10px] text-muted-foreground/50 italic">
                            Empty
                          </div>
                        ) : (
                          list.map(p => {
                            const isSelected = selectedPageName === p.page_name && p.category === (catKey === "root" ? "" : catKey);
                            return (
                              <div
                                key={`${p.category}/${p.page_name}`}
                                className={cn(
                                  "group flex flex-col px-2.5 py-1.5 rounded-sm cursor-pointer transition-all border border-transparent",
                                  isSelected
                                    ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/20 shadow-[inset_3px_0_0_0_#06b6d4]"
                                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                                )}
                                onClick={() => handleSelectPage(p.page_name, p.category)}
                              >
                                <div className="flex items-center justify-between text-xs font-medium truncate">
                                  <span>{p.title || p.page_name}</span>
                                </div>
                                
                                {p.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1 opacity-70 group-hover:opacity-100 transition-opacity">
                                    {p.tags.slice(0, 3).map(tag => (
                                      <span key={tag} className="text-[9px] font-mono px-1 bg-white/5 text-muted-foreground rounded-sm">
                                        #{tag}
                                      </span>
                                    ))}
                                    {p.tags.length > 3 && (
                                      <span className="text-[9px] font-mono px-1 text-muted-foreground/50">
                                        +{p.tags.length - 3}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* Main Panel */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-slate-950/10 backdrop-blur-3xl font-sans relative">
        {loadingDetail ? (
          <div className="flex-1 flex items-center justify-center">
            <Spinner className="size-7 text-cyan-400" />
          </div>
        ) : viewMode === "graph" ? (
          /* KNOWLEDGE GRAPH INTERACTIVE SCREEN */
          <div className="flex-1 flex flex-col min-h-0 relative select-none">
            {/* Graph Controls overlay */}
            <div className="absolute top-3 left-3 z-10 p-2.5 rounded-sm bg-slate-950/85 border border-white/10 max-w-xs space-y-2 font-mono text-[10px] text-muted-foreground shadow-xl backdrop-blur-md">
              <div className="font-semibold text-foreground flex items-center gap-1.5 text-xs text-cyan-400">
                <Sparkles className="size-3.5 animate-pulse" />
                <span>GRAPH EXPLORER</span>
              </div>
              <div className="space-y-1">
                <p>• Drag nodes to reposition</p>
                <p>• Drag background to pan canvas</p>
                <p>• Scroll wheel to zoom in/out</p>
                <p>• Click node to inspect details</p>
                <p>• Click stub notes to create files</p>
              </div>
              <div className="flex gap-1.5 pt-1.5 border-t border-white/5">
                <Button size="xs" outlined className="h-6 text-[9px] px-2 rounded-sm border-white/10 hover:bg-white/5" onClick={resetPanZoom}>
                  Reset View
                </Button>
                <Button size="xs" outlined className="h-6 text-[9px] px-2 rounded-sm border-white/10 hover:bg-white/5" onClick={fetchGraphData}>
                  <RefreshCw className="size-2.5 mr-1" /> Reload
                </Button>
              </div>
            </div>

            {loadingGraph ? (
              <div className="flex-1 flex items-center justify-center">
                <Spinner className="size-7 text-cyan-400" />
              </div>
            ) : (
              <div className="flex-1 relative overflow-hidden bg-slate-950/80">
                <svg
                  data-tick={tick}
                  className="w-full h-full cursor-grab active:cursor-grabbing"
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onWheel={handleWheel}
                >
                  <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                    {/* 1. Draw Links */}
                    {linksRef.current.map((link, i) => {
                      const u = nodesRef.current.find(n => n.id === link.source);
                      const v = nodesRef.current.find(n => n.id === link.target);
                      if (!u || !v) return null;
                      
                      const isHovered = hoveredNodeId === u.id || hoveredNodeId === v.id;
                      
                      return (
                        <line
                          key={i}
                          x1={u.x}
                          y1={u.y}
                          x2={v.x}
                          y2={v.y}
                          stroke={isHovered ? "rgba(6, 182, 212, 0.45)" : "rgba(255, 255, 255, 0.08)"}
                          strokeWidth={isHovered ? 1.5 : 1}
                          className="transition-all"
                        />
                      );
                    })}

                    {/* 2. Draw Nodes */}
                    {nodesRef.current.map(node => {
                      const isHovered = hoveredNodeId === node.id;
                      const color = getNodeColor(node);
                      const isStub = node.type === "stub";

                      return (
                        <g
                          key={node.id}
                          transform={`translate(${node.x}, ${node.y})`}
                          className="cursor-pointer"
                          onMouseDown={e => handleNodeMouseDown(node.id, e)}
                          onClick={e => handleNodeClick(node, e)}
                          onMouseEnter={() => setHoveredNodeId(node.id)}
                          onMouseLeave={() => setHoveredNodeId(null)}
                        >
                          <circle
                            r={isHovered ? 11 : 8}
                            fill={isStub ? "transparent" : color}
                            stroke={color}
                            strokeWidth={isStub ? 1.5 : 0}
                            strokeDasharray={isStub ? "3,3" : undefined}
                            className="transition-all duration-150"
                            style={{
                              filter: isHovered ? `drop-shadow(0 0 8px ${color})` : undefined,
                            }}
                          />
                          <text
                            y={isHovered ? -16 : -13}
                            textAnchor="middle"
                            fill={isHovered ? "#fff" : "rgba(255, 255, 255, 0.65)"}
                            fontSize={isHovered ? "11px" : "9px"}
                            fontWeight={isHovered ? "semibold" : "normal"}
                            className="font-mono transition-all pointer-events-none"
                          >
                            {node.title}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              </div>
            )}
          </div>
        ) : selectedPage ? (
          /* DOCUMENT VIEW */
          <div className="flex-1 flex flex-col min-h-0 bg-slate-900/10">
            {/* Top Toolbar */}
            <div className="h-12 shrink-0 border-b border-white/5 px-4 flex items-center justify-between bg-slate-950/30">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-cyan-400" />
                <h1 className="text-sm font-bold text-foreground font-mono">
                  {selectedPage.category ? `${selectedPage.category}/` : ""}{selectedPage.page_name}.md
                </h1>
                {selectedPage.category && (
                  <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 bg-cyan-950/50 text-cyan-400 border border-cyan-800/30 rounded-sm">
                    {selectedPage.category}
                  </span>
                )}
              </div>

              {!isEditing ? (
                <div className="flex items-center gap-2">
                  <Button
                    size="xs"
                    outlined
                    className="h-7 px-2.5 text-xs rounded-sm border-white/10 hover:bg-white/5 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setIsEditing(true);
                      setIsDirty(false);
                    }}
                  >
                    <Edit2 className="mr-1.5 size-3.5" />
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    ghost
                    className="h-7 px-2.5 text-xs rounded-sm hover:bg-rose-950/20 text-rose-400/80 hover:text-rose-400"
                    onClick={handleDeletePage}
                  >
                    <Trash2 className="mr-1.5 size-3.5" />
                    Delete
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    size="xs"
                    className="h-7 px-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-none border border-cyan-500/50"
                    disabled={isSaving}
                    onClick={handleSavePage}
                  >
                    <Save className="mr-1.5 size-3.5" />
                    {isSaving ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    size="xs"
                    outlined
                    className="h-7 px-2.5 text-xs rounded-sm border-white/10 hover:bg-white/5"
                    onClick={() => {
                      setIsEditing(false);
                      setIsDirty(false);
                      setEditContent(selectedPage.content);
                      setEditTitle(selectedPage.metadata.title || selectedPage.page_name);
                      setEditTags(Array.isArray(selectedPage.metadata.tags) ? selectedPage.metadata.tags.join(", ") : "");
                    }}
                  >
                    <X className="mr-1.5 size-3.5" />
                    Cancel
                  </Button>
                </div>
              )}
            </div>

            {/* Document Content View / Editor */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 min-h-0">
              {!isEditing ? (
                /* Note Viewer */
                <div className="max-w-3xl mx-auto space-y-6">
                  {/* Metadata Header card */}
                  <div className="p-4 border border-white/5 bg-slate-900/20 rounded-sm font-sans space-y-2.5 shadow-lg">
                    <div className="flex items-start justify-between">
                      <div>
                        <h2 className="text-xl font-bold text-foreground">
                          {selectedPage.metadata.title || selectedPage.page_name}
                        </h2>
                        <p className="text-[10px] text-muted-foreground font-mono mt-1">
                          File: {selectedPage.category ? `${selectedPage.category}/` : ""}{selectedPage.page_name}.md
                        </p>
                      </div>
                    </div>

                    {Array.isArray(selectedPage.metadata.tags) && selectedPage.metadata.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1.5 border-t border-white/5">
                        <Tag className="size-3.5 text-muted-foreground/60 shrink-0 mt-0.5" />
                        {selectedPage.metadata.tags.map(tag => (
                          <span key={tag} className="text-[10px] font-mono px-2 py-0.5 bg-slate-950/60 text-cyan-400 border border-cyan-950/40 rounded-sm">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Rendered Markdown Body */}
                  <div
                    onClick={handleWikiContainerClick}
                    className="prose prose-invert max-w-none p-5 border border-white/5 bg-slate-900/10 rounded-sm leading-relaxed"
                  >
                    {processedMarkdownContent ? (
                      <Markdown content={processedMarkdownContent} />
                    ) : (
                      <p className="text-muted-foreground text-xs italic">Empty note page.</p>
                    )}
                  </div>
                </div>
              ) : (
                /* Note Editor split panel */
                <div className="h-full flex flex-col gap-4 max-w-4xl mx-auto">
                  {/* Frontmatter settings block */}
                  <div className="grid gap-3 p-4 bg-slate-900/20 border border-white/5 rounded-sm">
                    <h3 className="text-xs font-bold text-muted-foreground font-mono uppercase tracking-wider flex items-center gap-1.5">
                      <Tag className="size-3 text-cyan-400" /> Page Frontmatter Metadata
                    </h3>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-mono text-muted-foreground mb-1">Title</label>
                        <Input
                          className="h-8 rounded-none border border-white/10 bg-slate-950/50 text-xs text-foreground focus-visible:ring-1 focus-visible:ring-cyan-500/50"
                          value={editTitle}
                          onChange={e => {
                            setEditTitle(e.target.value);
                            setIsDirty(true);
                          }}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-mono text-muted-foreground mb-1">Tags (comma separated)</label>
                        <Input
                          className="h-8 rounded-none border border-white/10 bg-slate-950/50 text-xs text-foreground placeholder:text-muted-foreground/45 focus-visible:ring-1 focus-visible:ring-cyan-500/50"
                          placeholder="tag1, tag2, tag3"
                          value={editTags}
                          onChange={e => {
                            setEditTags(e.target.value);
                            setIsDirty(true);
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Body Text Editor */}
                  <div className="flex-1 flex flex-col min-h-0 border border-white/5 bg-slate-950/30 rounded-sm">
                    <div className="h-8 bg-slate-950/60 border-b border-white/5 px-3 flex items-center justify-between text-[10px] font-mono text-muted-foreground select-none">
                      <span>Markdown Content Body</span>
                      {isDirty && <span className="text-amber-400 flex items-center gap-1"><AlertCircle className="size-3" /> Unsaved modifications</span>}
                    </div>
                    <textarea
                      className="flex-1 w-full bg-transparent p-4 text-xs font-mono text-foreground leading-relaxed resize-none focus:outline-none focus:ring-0"
                      value={editContent}
                      onChange={e => {
                        setEditContent(e.target.value);
                        setIsDirty(true);
                      }}
                      placeholder="# Your markdown header here..."
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <div className="max-w-sm space-y-3 font-mono text-muted-foreground text-xs border border-white/5 p-8 bg-slate-900/10 backdrop-blur-md rounded-sm">
              <BookOpen className="size-10 mx-auto text-cyan-400 opacity-60" />
              <h3 className="font-bold text-foreground">Welcome to LLM Wiki</h3>
              <p className="leading-relaxed">
                Click a note in the sidebar folder, double-click graph nodes, or create a new page to manage Agent memory notes.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* CREATE NEW PAGE MODAL DIALOG */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm border border-white/10 bg-slate-900 p-5 shadow-2xl font-sans rounded-sm space-y-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
              <h3 className="text-sm font-bold text-foreground font-mono flex items-center gap-1.5">
                <Plus className="size-4 text-cyan-400" /> Create New Memory Note
              </h3>
              <button className="text-muted-foreground hover:text-foreground transition-colors" onClick={() => setShowCreateModal(false)}>
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleCreatePageSubmit} className="space-y-3">
              <div>
                <label className="block text-[10px] font-mono text-muted-foreground mb-1 uppercase tracking-wider">Note Filename</label>
                <Input
                  autoFocus
                  className="h-8 rounded-none border border-white/10 bg-slate-950/50 text-xs text-foreground focus-visible:ring-1 focus-visible:ring-cyan-500/50"
                  placeholder="e.g. athena-architecture"
                  value={newPageName}
                  onChange={e => setNewPageName(e.target.value)}
                />
                <span className="text-[9px] text-muted-foreground/60 mt-1 block">
                  Only alpha-numerics, hyphens, and underscores are allowed.
                </span>
              </div>

              <div>
                <label className="block text-[10px] font-mono text-muted-foreground mb-1 uppercase tracking-wider">Category Folder</label>
                <select
                  className="w-full h-8 px-2 border border-white/10 bg-slate-950 text-xs text-foreground rounded-none focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                  value={newPageCategory}
                  onChange={e => setNewPageCategory(e.target.value)}
                >
                  <option value="">(Root / Uncategorized)</option>
                  <option value="concepts">Concepts</option>
                  <option value="entities">Entities</option>
                  <option value="sources">Sources</option>
                </select>
              </div>

              <div className="flex gap-2 justify-end pt-3.5 border-t border-white/5">
                <Button
                  size="xs"
                  outlined
                  className="h-7 text-xs rounded-sm border-white/10 hover:bg-white/5"
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="xs"
                  className="h-7 bg-cyan-600 hover:bg-cyan-500 text-white rounded-none border border-cyan-500/50"
                  type="submit"
                  disabled={isSaving}
                >
                  {isSaving ? "Creating..." : "Create Page"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DISCARD CHANGES WARNING DIALOG */}
      {showUnsavedConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-xs border border-rose-950/30 bg-slate-900 p-5 shadow-2xl font-sans rounded-sm space-y-4">
            <div className="flex items-center gap-2 text-rose-400">
              <AlertCircle className="size-5 shrink-0" />
              <h3 className="text-sm font-bold font-mono">Unsaved Changes</h3>
            </div>
            
            <p className="text-xs text-muted-foreground leading-relaxed">
              You have edited this note but did not save your changes. If you navigate away, your progress will be lost.
            </p>

            <div className="flex gap-2 justify-end pt-3 border-t border-white/5">
              <Button
                size="xs"
                outlined
                className="h-7 text-xs rounded-sm border-white/10 hover:bg-white/5 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setShowUnsavedConfirm(false);
                  setPendingAction(null);
                }}
              >
                Keep Editing
              </Button>
              <Button
                size="xs"
                className="h-7 bg-rose-600 hover:bg-rose-500 text-white rounded-none border border-rose-500/50"
                onClick={handleConfirmDiscard}
              >
                Discard Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  );
}
