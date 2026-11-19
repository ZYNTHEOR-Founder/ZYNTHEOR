import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { SoftwareProjectRecord } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { StatusDot, MinimalIndicatorState } from '../ui/StatusBadge';

export interface ProjectFileEntry {
  relativePath: string;
  bytes: number;
  sha256?: string;
  snapshotId?: string | null;
}

interface TreeFolderNode {
  kind: 'folder';
  name: string;
  path: string;
  children: TreeNode[];
}

interface TreeFileNode {
  kind: 'file';
  name: string;
  path: string;
  file: ProjectFileEntry;
}

type TreeNode = TreeFolderNode | TreeFileNode;

export interface ProjectExplorerProps {
  projects: SoftwareProjectRecord[];
  selectedProject: SoftwareProjectRecord | null;
  onSelectProject: (projectId: string) => void;
  onRefreshProjects?: () => void;
  onNewApp?: () => void;
  files: ProjectFileEntry[];
  selectedFilePath: string;
  loadingFilePath?: string | null;
  onSelectFile: (relativePath: string) => void | Promise<void>;
  onCreateFile?: (relativePath: string) => void | Promise<void>;
  onDeleteFile?: (relativePath: string) => void | Promise<void>;
  toDotState?: (raw: string | undefined | null) => MinimalIndicatorState;
}

function buildNestedTree(files: ProjectFileEntry[], filterQuery: string): TreeNode[] {
  const query = filterQuery.trim().toLowerCase();
  const filtered = query
    ? files.filter((f) => f.relativePath.toLowerCase().includes(query))
    : files;

  const rootFolder: TreeFolderNode = {
    kind: 'folder',
    name: '',
    path: '',
    children: [],
  };

  for (const file of filtered) {
    const clean = file.relativePath.replace(/^\/+/, '');
    const parts = clean.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    let current = rootFolder;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      const currentPath = parts.slice(0, i + 1).join('/');

      if (isLeaf) {
        current.children.push({
          kind: 'file',
          name: part,
          path: file.relativePath,
          file,
        });
      } else {
        let folder = current.children.find(
          (c): c is TreeFolderNode => c.kind === 'folder' && c.name === part
        );
        if (!folder) {
          folder = {
            kind: 'folder',
            name: part,
            path: currentPath,
            children: [],
          };
          current.children.push(folder);
        }
        current = folder;
      }
    }
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.kind === 'folder') sortNodes(node.children);
    }
    return nodes;
  };

  return sortNodes(rootFolder.children);
}

function collectFolderPaths(nodes: TreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind === 'folder') {
      paths.push(node.path, ...collectFolderPaths(node.children));
    }
  }
  return paths;
}

function renderFileIcon(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.json')) {
    return <FileJson className="w-3.5 h-3.5 shrink-0 text-[color-mix(in_srgb,var(--z-ok)_90%,transparent)]" />;
  }
  if (lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.template')) {
    return <FileText className="w-3.5 h-3.5 shrink-0 text-[var(--app-text-secondary)]" />;
  }
  return <FileCode className="w-3.5 h-3.5 shrink-0 text-[color-mix(in_srgb,var(--app-accent)_90%,transparent)]" />;
}

export const ProjectExplorer: React.FC<ProjectExplorerProps> = ({
  projects,
  selectedProject,
  onSelectProject,
  onRefreshProjects,
  onNewApp,
  files,
  selectedFilePath,
  loadingFilePath,
  onSelectFile,
  onCreateFile,
  onDeleteFile,
  toDotState,
}) => {
  const { lang } = useLanguage();
  const th = lang === 'th';

  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({});
  const [fileFilter, setFileFilter] = useState('');
  const [newFileRelPath, setNewFileRelPath] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [showPipelineDetails, setShowPipelineDetails] = useState(false);

  const treeNodes = useMemo(() => buildNestedTree(files, fileFilter), [files, fileFilter]);
  const allFolderPaths = useMemo(() => collectFolderPaths(treeNodes), [treeNodes]);

  const handleToggleDir = (dirPath: string) => {
    setCollapsedDirs((prev) => ({ ...prev, [dirPath]: !prev[dirPath] }));
  };

  const handleSetAllCollapsed = (collapsed: boolean) => {
    const next: Record<string, boolean> = {};
    for (const p of allFolderPaths) next[p] = collapsed;
    setCollapsedDirs(next);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newFileRelPath.trim().replace(/^\/+/, '');
    if (!cleaned || !onCreateFile || isCreating) return;
    setIsCreating(true);
    try {
      await onCreateFile(cleaned);
      setNewFileRelPath('');
    } finally {
      setIsCreating(false);
    }
  };

  const renderTreeNodes = (nodes: TreeNode[], depth = 0): React.ReactNode =>
    nodes.map((node) => {
      if (node.kind === 'folder') {
        const isCollapsed = fileFilter.trim() ? false : Boolean(collapsedDirs[node.path]);
        return (
          <div key={`folder:${node.path}`} className="space-y-0.5">
            <button
              type="button"
              onClick={() => handleToggleDir(node.path)}
              style={{ paddingLeft: `${depth * 12 + 6}px` }}
              className="w-full flex items-center gap-1.5 pr-2 py-1 rounded-lg text-[11px] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] hover:bg-[color-mix(in_srgb,var(--app-surface-elevated)_50%,transparent)] cursor-pointer transition-colors"
            >
              {isCollapsed ? (
                <ChevronRight className="w-3 h-3 shrink-0" />
              ) : (
                <ChevronDown className="w-3 h-3 shrink-0" />
              )}
              {isCollapsed ? (
                <Folder className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0" />
              ) : (
                <FolderOpen className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0" />
              )}
              <span className="truncate font-semibold">{node.name}</span>
            </button>
            {!isCollapsed && <div>{renderTreeNodes(node.children, depth + 1)}</div>}
          </div>
        );
      }

      const isSelected = node.path === selectedFilePath;
      const isLoading = loadingFilePath === node.path;

      return (
        <div
          key={`file:${node.path}`}
          style={{ paddingLeft: `${depth * 12 + 18}px` }}
          className={`group flex items-center justify-between gap-1.5 pr-1.5 py-1 rounded-lg transition-colors ${
            isSelected
              ? 'bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] text-[var(--app-accent)] border border-[color-mix(in_srgb,var(--app-accent)_30%,transparent)]'
              : 'text-[var(--app-text-secondary)] hover:bg-[color-mix(in_srgb,var(--app-surface-elevated)_60%,transparent)] border border-transparent'
          }`}
        >
          <button
            type="button"
            onClick={() => void onSelectFile(node.path)}
            className="flex items-center gap-1.5 truncate text-left flex-1 cursor-pointer text-[11px] min-w-0"
            title={node.path}
          >
            {renderFileIcon(node.path)}
            <span className="truncate">{node.name}</span>
            {isLoading && (
              <span className="text-[9px] text-[var(--app-accent)] shrink-0">
                {th ? 'กำลังโหลด' : 'loading'}
              </span>
            )}
          </button>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[10px] text-[var(--app-text-secondary)] tabular-nums">
              {node.file.bytes}B
            </span>
            {onDeleteFile && (
              <button
                type="button"
                onClick={() => void onDeleteFile(node.path)}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 text-[var(--app-text-secondary)] hover:text-[var(--z-danger)] cursor-pointer transition-opacity"
                title={th ? `ลบ ${node.path}` : `Delete ${node.path}`}
                aria-label={th ? `ลบ ${node.path}` : `Delete ${node.path}`}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      );
    });

  return (
    <div className="h-full flex flex-col bg-[var(--app-surface)] text-[var(--app-text-primary)] min-w-0">
      {/* Header */}
      <div className="px-3.5 py-2.5 bg-[var(--app-bg-secondary)] border-b border-[var(--app-card-border)] flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <div className="text-xs font-bold text-[var(--app-text-primary)] truncate">
            {th ? 'ตัวสำรวจโปรเจกต์ (Project Explorer)' : 'Project Explorer'}
          </div>
          <div className="text-[11px] font-mono text-[var(--app-text-secondary)] tabular-nums">
            {projects.length} {th ? 'แอป' : 'app(s)'} · {files.length} {th ? 'ไฟล์' : 'file(s)'}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onNewApp && (
            <button
              type="button"
              onClick={onNewApp}
              className="px-2 py-1 rounded-lg bg-[color-mix(in_srgb,var(--app-accent)_15%,transparent)] text-[var(--app-accent)] hover:bg-[color-mix(in_srgb,var(--app-accent)_25%,transparent)] text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap cursor-pointer"
              title={th ? 'โฟกัสที่ช่องสร้างแอปใหม่' : 'Focus new app prompt'}
            >
              <Plus className="w-3 h-3" />
              <span>{th ? 'แอปใหม่' : 'New App'}</span>
            </button>
          )}
          {onRefreshProjects && (
            <button
              type="button"
              onClick={onRefreshProjects}
              className="p-1.5 rounded-lg text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] cursor-pointer"
              title={th ? 'รีเฟรชรายการโปรเจกต์' : 'Refresh projects'}
              aria-label={th ? 'รีเฟรชรายการโปรเจกต์' : 'Refresh projects'}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Application Selector List */}
      <div className="p-2.5 border-b border-[var(--app-card-border)] max-h-44 overflow-y-auto divide-y divide-[var(--app-card-border)] shrink-0">
        {projects.length === 0 ? (
          <div className="py-4 text-center text-xs text-[var(--app-text-secondary)]">
            {th
              ? 'ยังไม่มีแอปพลิเคชันที่สร้าง ระบุรายละเอียดด้านบนแล้วกดรันงานแอปพลิเคชัน'
              : 'No applications created yet. Describe an app above and click Execute Application Task.'}
          </div>
        ) : (
          projects.map((p) => {
            const active = p.projectId === selectedProject?.projectId;
            return (
              <button
                key={p.projectId}
                type="button"
                onClick={() => onSelectProject(p.projectId)}
                className={`w-full py-2 px-2 text-left transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                  active ? 'bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] rounded-lg' : 'hover:bg-[color-mix(in_srgb,var(--app-surface-elevated)_60%,transparent)]'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[var(--app-text-primary)] truncate">{p.name}</div>
                  <div className="text-[10px] font-mono text-[var(--app-text-secondary)] tabular-nums truncate">
                    {p.stack} · {p.currentRevision}
                  </div>
                </div>
                <StatusDot
                  status={
                    p.lastTests?.status === 'VERIFIED'
                      ? 'VERIFIED'
                      : p.lastBuild?.status === 'FAILED' ||
                          p.lastTests?.status === 'FAILED' ||
                          p.lastSecurityScan?.status === 'BLOCKED'
                        ? 'BLOCKED'
                        : 'UNVERIFIED'
                  }
                  label={p.lastTests?.status || 'UNVERIFIED'}
                  pulse={false}
                />
              </button>
            );
          })
        )}
      </div>

      {/* Interactive Nested File Tree */}
      {selectedProject && (
        <div className="p-2.5 space-y-2 flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--app-text-secondary)] px-1 shrink-0">
            <span className="truncate">
              {th ? `โครงสร้างซอร์สโค้ด (${selectedProject.currentRevision})` : `Source Tree (${selectedProject.currentRevision})`}
            </span>
            <div className="flex items-center gap-1.5 font-mono text-[10px] shrink-0">
              {allFolderPaths.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => handleSetAllCollapsed(false)}
                    className="hover:text-[var(--app-accent)] cursor-pointer"
                    title={th ? 'ขยายโฟลเดอร์ทั้งหมด' : 'Expand all folders'}
                  >
                    {th ? 'ขยาย' : 'Expand'}
                  </button>
                  <span aria-hidden="true">/</span>
                  <button
                    type="button"
                    onClick={() => handleSetAllCollapsed(true)}
                    className="hover:text-[var(--app-accent)] cursor-pointer"
                    title={th ? 'ย่อโฟลเดอร์ทั้งหมด' : 'Collapse all folders'}
                  >
                    {th ? 'ย่อ' : 'Collapse'}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Search files */}
          <div className="relative shrink-0">
            <Search className="w-3.5 h-3.5 text-[var(--app-text-secondary)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={fileFilter}
              onChange={(e) => setFileFilter(e.target.value)}
              placeholder={th ? 'กรองไฟล์โปรเจกต์...' : 'Filter project files...'}
              aria-label={th ? 'กรองไฟล์โปรเจกต์' : 'Filter project files'}
              className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)] text-[11px] font-mono text-[var(--app-text-primary)] placeholder:text-[var(--app-text-secondary)] focus:outline-none focus:border-[var(--app-accent)]"
            />
          </div>

          {onCreateFile && (
            <form onSubmit={handleCreateSubmit} className="flex gap-1.5 shrink-0">
              <input
                type="text"
                value={newFileRelPath}
                onChange={(e) => setNewFileRelPath(e.target.value)}
                placeholder="src/helper.mjs"
                aria-label={th ? 'พาธไฟล์ใหม่' : 'New file relative path'}
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)] text-[11px] font-mono text-[var(--app-text-primary)] focus:outline-none focus:border-[var(--app-accent)]"
              />
              <button
                type="submit"
                disabled={isCreating || !newFileRelPath.trim()}
                className="px-2.5 py-1.5 rounded-lg bg-[var(--app-surface-elevated)] border border-[var(--app-card-border)] hover:border-[var(--app-accent)] text-[var(--app-accent)] text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                {th ? '+ ไฟล์' : '+ File'}
              </button>
            </form>
          )}

          <div className="space-y-0.5 flex-1 min-h-[160px] max-h-80 overflow-y-auto text-xs font-mono pr-0.5">
            {treeNodes.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-[var(--app-text-secondary)]">
                {fileFilter.trim()
                  ? th
                    ? `ไม่พบไฟล์ที่ตรงกับ "${fileFilter.trim()}"`
                    : `No files match "${fileFilter.trim()}"`
                  : th
                    ? 'ไม่มีไฟล์ในเวอร์ชันที่ใช้งานอยู่'
                    : 'No files in active revision.'}
              </div>
            ) : (
              renderTreeNodes(treeNodes)
            )}
          </div>

          {/* Collapsible 13-Stage Lifecycle Summary */}
          <div className="pt-2 border-t border-[var(--app-card-border)] shrink-0">
            <button
              type="button"
              onClick={() => setShowPipelineDetails((v) => !v)}
              className="w-full flex items-center justify-between text-[11px] font-semibold text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] py-1 cursor-pointer"
            >
              <span>
                {th
                  ? `วงจรชีวิต 13 ขั้นตอน (ผ่าน ${selectedProject.stages.filter((s) => s.status === 'VERIFIED').length}/13)`
                  : `13-Stage Lifecycle (${selectedProject.stages.filter((s) => s.status === 'VERIFIED').length}/13 verified)`}
              </span>
              {showPipelineDetails ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
            {showPipelineDetails && (
              <div className="mt-1.5 divide-y divide-[var(--app-card-border)] max-h-56 overflow-y-auto text-[10px]">
                {selectedProject.stages.map((st) => (
                  <div key={st.stage} className="py-1.5 flex items-center justify-between gap-2">
                    <span className="text-[var(--app-text-secondary)] truncate">
                      {String(st.order).padStart(2, '0')}. {st.label}
                    </span>
                    <StatusDot
                      status={toDotState ? toDotState(st.status) : 'UNVERIFIED'}
                      label={st.status}
                      pulse={false}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectExplorer;
