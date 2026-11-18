import React, { useEffect, useState } from 'react';
import { Group, Panel, Separator, useGroupRef, usePanelRef } from 'react-resizable-panels';
import { PanelLeft, PanelRight, RotateCcw } from 'lucide-react';

export interface WorkspaceLayoutProps {
  explorer: React.ReactNode;
  editor: React.ReactNode;
  inspector: React.ReactNode;
  explorerLabel?: string;
  editorLabel?: string;
  inspectorLabel?: string;
}

const DEFAULT_LAYOUT = {
  explorer: 24,
  editor: 51,
  inspector: 25,
};

function useIsDesktopLg() {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia('(min-width: 1024px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}

export const WorkspaceLayout: React.FC<WorkspaceLayoutProps> = ({
  explorer,
  editor,
  inspector,
  explorerLabel = 'Explorer',
  editorLabel = 'Editor & Preview',
  inspectorLabel = 'Inspector',
}) => {
  const isDesktop = useIsDesktopLg();
  const groupRef = useGroupRef();
  const explorerPanelRef = usePanelRef();
  const inspectorPanelRef = usePanelRef();

  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);

  const toggleExplorer = () => {
    const panel = explorerPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      setExplorerCollapsed(false);
    } else {
      panel.collapse();
      setExplorerCollapsed(true);
    }
  };

  const toggleInspector = () => {
    const panel = inspectorPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      setInspectorCollapsed(false);
    } else {
      panel.collapse();
      setInspectorCollapsed(true);
    }
  };

  const resetPanels = () => {
    explorerPanelRef.current?.expand();
    inspectorPanelRef.current?.expand();
    setExplorerCollapsed(false);
    setInspectorCollapsed(false);
    groupRef.current?.setLayout(DEFAULT_LAYOUT);
  };

  return (
    <div className="space-y-2.5">
      {/* Desktop 3-column layout controls */}
      {isDesktop && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[var(--app-bg-secondary)] border border-[var(--app-card-border)] text-[11px]">
          <div className="flex items-center gap-2 font-mono text-[var(--app-text-secondary)]">
            <span>3-Column Workspace</span>
            <span aria-hidden="true">·</span>
            <span>{explorerLabel}</span>
            <span aria-hidden="true">/</span>
            <span className="text-[var(--app-text-primary)] font-semibold">{editorLabel}</span>
            <span aria-hidden="true">/</span>
            <span>{inspectorLabel}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={toggleExplorer}
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                explorerCollapsed
                  ? 'bg-[var(--app-bg)] border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                  : 'bg-[var(--app-surface-elevated)] border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] text-[var(--app-accent)]'
              }`}
              title={explorerCollapsed ? `Show ${explorerLabel}` : `Collapse ${explorerLabel}`}
            >
              <PanelLeft className="w-3.5 h-3.5" />
              <span>{explorerCollapsed ? `Show ${explorerLabel}` : explorerLabel}</span>
            </button>

            <button
              type="button"
              onClick={toggleInspector}
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                inspectorCollapsed
                  ? 'bg-[var(--app-bg)] border-[var(--app-card-border)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)]'
                  : 'bg-[var(--app-surface-elevated)] border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] text-[var(--app-accent)]'
              }`}
              title={inspectorCollapsed ? `Show ${inspectorLabel}` : `Collapse ${inspectorLabel}`}
            >
              <PanelRight className="w-3.5 h-3.5" />
              <span>{inspectorCollapsed ? `Show ${inspectorLabel}` : inspectorLabel}</span>
            </button>

            <button
              type="button"
              onClick={resetPanels}
              className="px-2.5 py-1 rounded-lg bg-[var(--app-bg)] border border-[var(--app-card-border)] hover:border-[color-mix(in_srgb,var(--app-accent)_50%,transparent)] text-[var(--app-text-secondary)] text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap cursor-pointer"
              title="Reset 3-column layout proportions"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Layout</span>
            </button>
          </div>
        </div>
      )}

      {isDesktop ? (
        <Group
          id="zyntheor-workspace-columns"
          groupRef={groupRef}
          orientation="horizontal"
          defaultLayout={DEFAULT_LAYOUT}
          className="w-full items-stretch rounded-2xl border border-[var(--app-card-border)] bg-[var(--app-surface)] overflow-hidden"
        >
          <Panel
            id="explorer"
            panelRef={explorerPanelRef}
            defaultSize="24%"
            minSize="16%"
            maxSize="40%"
            collapsible
            collapsedSize="0%"
            onResize={(size) => {
              setExplorerCollapsed(size.asPercentage <= 1);
            }}
            className="min-w-0 bg-[var(--app-surface)]"
          >
            <aside aria-label={explorerLabel} className="h-full min-w-0 overflow-hidden">
              {explorer}
            </aside>
          </Panel>

          <Separator
            id="sep-explorer-editor"
            aria-label={`Resize ${explorerLabel} and ${editorLabel}`}
            className="w-1.5 bg-[color-mix(in_srgb,var(--app-card-border)_70%,transparent)] hover:bg-[color-mix(in_srgb,var(--app-accent)_70%,transparent)] data-[separator=active]:bg-[var(--app-accent)] transition-colors cursor-col-resize relative flex items-center justify-center focus:outline-none focus-visible:bg-[var(--app-accent)]"
          >
            <span className="h-8 w-0.5 rounded-full bg-[var(--app-text-secondary)] pointer-events-none" />
          </Separator>

          <Panel
            id="editor"
            defaultSize="51%"
            minSize="32%"
            className="min-w-0 bg-[var(--app-surface)]"
          >
            <main aria-label={editorLabel} className="h-full min-w-0 overflow-hidden">
              {editor}
            </main>
          </Panel>

          <Separator
            id="sep-editor-inspector"
            aria-label={`Resize ${editorLabel} and ${inspectorLabel}`}
            className="w-1.5 bg-[color-mix(in_srgb,var(--app-card-border)_70%,transparent)] hover:bg-[color-mix(in_srgb,var(--app-accent)_70%,transparent)] data-[separator=active]:bg-[var(--app-accent)] transition-colors cursor-col-resize relative flex items-center justify-center focus:outline-none focus-visible:bg-[var(--app-accent)]"
          >
            <span className="h-8 w-0.5 rounded-full bg-[var(--app-text-secondary)] pointer-events-none" />
          </Separator>

          <Panel
            id="inspector"
            panelRef={inspectorPanelRef}
            defaultSize="25%"
            minSize="18%"
            maxSize="42%"
            collapsible
            collapsedSize="0%"
            onResize={(size) => {
              setInspectorCollapsed(size.asPercentage <= 1);
            }}
            className="min-w-0 bg-[var(--app-surface)]"
          >
            <aside aria-label={inspectorLabel} className="h-full min-w-0 overflow-hidden">
              {inspector}
            </aside>
          </Panel>
        </Group>
      ) : (
        <div className="flex flex-col gap-4">
          <aside
            aria-label={explorerLabel}
            className="rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] overflow-hidden min-w-0"
          >
            {explorer}
          </aside>
          <main
            aria-label={editorLabel}
            className="rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] overflow-hidden min-w-0"
          >
            {editor}
          </main>
          <aside
            aria-label={inspectorLabel}
            className="rounded-2xl bg-[var(--app-surface)] border border-[var(--app-card-border)] overflow-hidden min-w-0"
          >
            {inspector}
          </aside>
        </div>
      )}
    </div>
  );
};

export default WorkspaceLayout;
