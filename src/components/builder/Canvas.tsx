import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, PointerSensor, TouchSensor, closestCenter, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent, type Announcements,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Copy, Plus, Trash } from "lucide-react";
import type { App, Block, BlockType } from "@/lib/schema";
import { isFieldType } from "@/lib/schema";
import { cloneBlock, locate, makeBlock, seitenTitel, seitenVon, stepsUsing, walk } from "@/lib/model";
import { BlockContent, type RenderList } from "@/components/renderer/BlockContent";
import { themeStyle } from "@/components/renderer/theme";
import { BT, GROUPS } from "./catalog";
import type { Builder } from "./useBuilder";

/* ---------- Listen im Baum ---------- */
export function listOf(app: App, listId: string): Block[] | null {
  if (listId === "root") return app.blocks;
  const [bid, part] = listId.split(":");
  const loc = locate(app.blocks, bid);
  if (!loc) return null;
  if (part === "c") return loc.b.children ?? null;
  return loc.b.cols?.[Number(part)] ?? null;
}

/* ---------- Palette ---------- */
function PaletteItem({ type, onAdd }: { type: BlockType; onAdd: (t: BlockType) => void }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `neu:${type}`, data: { neu: type } });
  const { label, icon: Icon } = BT[type];
  return (
    <button ref={setNodeRef} type="button" className="pal-item" {...listeners} {...attributes} onClick={() => onAdd(type)}
      aria-label={`${label} hinzufügen`} aria-roledescription="Baustein zum Ziehen" title="Auf die Fläche ziehen oder anklicken">
      <span className="g" aria-hidden="true"><Icon size={14} /></span><span className="pal-txt">{label}</span>
    </button>
  );
}

export function Palette({ onAdd }: { onAdd: (t: BlockType) => void }) {
  return (
    <aside className="panel pal" aria-label="Bausteine">
      <div className="pal-groups">
        {/* Seiten entstehen über „+ Seite“ an den Seiten-Reitern, deshalb nicht in der Palette. */}
        {GROUPS.map((g) => (
          <div key={g} className="pal-g" data-g={g}>
            <span className="rubrik">{g}</span>
            <div className="pal-items">
              {(Object.keys(BT) as BlockType[]).filter((t) => BT[t].group === g).map((t) => <PaletteItem key={t} type={t} onAdd={onAdd} />)}
            </div>
          </div>
        ))}
      </div>
      <p className="hint" style={{ margin: 0 }}>Ziehen oder anklicken. Auf der Fläche: Leertaste verschiebt, Eingabetaste öffnet die Eigenschaften.</p>
    </aside>
  );
}

/* ---------- Bausteine auf der Fläche ---------- */
type EditCtx = { b: Builder; onDelete: (id: string) => void; onFocusProp: (id: string) => void };

function blockLabel(x: Block, ki?: string): string {
  const p = x.props as Record<string, unknown>;
  const t = (p.text ?? p.label ?? p.titel ?? "") as string;
  return `${BT[x.type].label}${t ? `: ${String(t).slice(0, 40)}` : ""}${ki ? `, ${ki}` : ""}`;
}

function SortBlock({ x, listId, ctx, renderList }: { x: Block; listId: string; ctx: EditCtx; renderList: RenderList }) {
  const { b } = ctx;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: x.id, data: { listId } });
  const sel = b.sel === x.id;
  let use: ReactNode = null;
  let kiText: string | undefined;
  if (isFieldType(x.type)) {
    const u = stepsUsing(b.app, (x.props as { key: string }).key);
    kiText = u.length ? `geht an Schritt ${u.map((i) => i + 1).join(", ")}` : "geht an keinen KI-Schritt";
    use = <span className={`b-use ${u.length ? "" : "off"}`} aria-hidden="true">{kiText}</span>;
  }
  const move = (dir: -1 | 1) => b.change((d) => {
    const loc = locate(d.blocks, x.id);
    if (!loc) return;
    const j = loc.i + dir;
    if (j < 0 || j >= loc.list.length) return;
    [loc.list[loc.i], loc.list[j]] = [loc.list[j], loc.list[loc.i]];
  });
  const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation() };
  return (
    <div ref={setNodeRef} className="b" data-sel={sel} data-dragging={isDragging} data-bid={x.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes} {...listeners} aria-label={blockLabel(x, kiText)}
      aria-description="Eingabetaste: Eigenschaften bearbeiten. Leertaste: verschieben. Entf: löschen."
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); ctx.onFocusProp(x.id); return; }
        listeners?.onKeyDown?.(e);
      }}
      onClick={(e) => { e.stopPropagation(); b.setSel(x.id); }}
      onFocus={(e) => { if (e.target === e.currentTarget) b.setSel(x.id); }}
      onDoubleClick={(e) => { e.stopPropagation(); ctx.onFocusProp(x.id); }}>
      <span className="b-tag" aria-hidden="true">{BT[x.type].label}{isFieldType(x.type) ? ` {{${(x.props as { key: string }).key}}}` : ""}</span>
      {use}
      {sel && (
        <span className="absolute -top-[22px] right-0 z-10 flex gap-0.5" {...stop}>
          {[["Nach oben", ArrowUp, () => move(-1)], ["Nach unten", ArrowDown, () => move(1)], ["Duplizieren", Copy, () => b.change((d) => { const loc = locate(d.blocks, x.id); if (loc) loc.list.splice(loc.i + 1, 0, cloneBlock(loc.b, d)); })], ["Löschen", Trash, () => ctx.onDelete(x.id)]].map(([t, Icon, fn]) => {
            const I = Icon as typeof ArrowUp;
            return <button key={t as string} type="button" title={t as string} aria-label={t as string} onClick={(e) => { e.stopPropagation(); (fn as () => void)(); }}
              className="grid size-6 place-items-center border border-[var(--tool)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--tool)] hover:text-[var(--tool-ink)]"><I size={13} /></button>;
          })}
        </span>
      )}
      <BlockContent b={x} app={b.app} mode="edit" renderList={renderList} />
    </div>
  );
}

function EditList({ blocks, listId, ctx }: { blocks: Block[]; listId: string; ctx: EditCtx }) {
  const { setNodeRef, isOver } = useDroppable({ id: `liste:${listId}`, data: { listId } });
  const renderList: RenderList = (bl, id) => <EditList blocks={bl} listId={id} ctx={ctx} />;
  return (
    <SortableContext id={listId} items={blocks.map((x) => x.id)} strategy={verticalListSortingStrategy}>
      <div ref={setNodeRef} className="b-list" data-over={isOver} data-list={listId}>
        {blocks.length ? blocks.map((x) => <SortBlock key={x.id} x={x} listId={listId} ctx={ctx} renderList={renderList} />)
          : <div className="b-empty">Bausteine hierher ziehen</div>}
      </div>
    </SortableContext>
  );
}

/* ---------- Ziehen und Ablegen ---------- */
const ankuendigungen: Announcements = {
  onDragStart: ({ active }) => `${String(active.id).startsWith("neu:") ? "Neuer Baustein" : "Baustein"} aufgenommen.`,
  onDragOver: ({ over }) => (over ? "Über einer Ablagestelle." : "Keine Ablagestelle."),
  onDragEnd: ({ over }) => (over ? "Baustein abgelegt." : "Ablegen abgebrochen."),
  onDragCancel: () => "Ziehen abgebrochen.",
};

export function UiDnd({ b, children, onAdded, onSeiteNeu }: { b: Builder; children: ReactNode; onAdded: (id: string) => void; onSeiteNeu: () => void }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } }),
  );
  const ausgeschlossen = useRef<Set<string>>(new Set());
  const [aktiv, setAktiv] = useState<string | null>(null);

  const collision: CollisionDetection = (args) => {
    const ex = ausgeschlossen.current;
    const containers = args.droppableContainers.filter((c) => !ex.has(String(c.id)));
    const a = { ...args, droppableContainers: containers };
    const p = pointerWithin(a);
    if (p.length) {
      const area = (id: string | number) => { const r = args.droppableRects.get(id); return r ? r.width * r.height : Infinity; };
      return [...p].sort((x, y) => area(x.id) - area(y.id)).slice(0, 1);
    }
    return closestCenter(a);
  };

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    setAktiv(id);
    const ex = new Set<string>();
    if (!id.startsWith("neu:")) {
      const loc = locate(b.app.blocks, id);
      // Ein Container darf nicht in sich selbst oder in eigene Unterlisten abgelegt werden.
      if (loc) walk([loc.b], (x) => {
        if (x.id !== id) ex.add(x.id);
        if (x.children) ex.add(`liste:${x.id}:c`);
        x.cols?.forEach((_, i) => ex.add(`liste:${x.id}:${i}`));
      });
    }
    ausgeschlossen.current = ex;
  };

  const onDragEnd = (e: DragEndEvent) => {
    setAktiv(null);
    const { active, over } = e;
    ausgeschlossen.current = new Set();
    if (!over) return;
    const activeId = String(active.id), overId = String(over.id);
    if (activeId === overId) return;
    const neu = (active.data.current as { neu?: BlockType } | undefined)?.neu;
    // Eine neue Seite landet immer als eigene Seite hinter der aktuellen, egal wo sie abgelegt wird.
    if (neu === "seite") { onSeiteNeu(); return; }
    const overList = (over.data.current as { listId?: string } | undefined)?.listId;
    const listId = overId.startsWith("liste:") ? overId.slice(6) : overList;
    if (!listId) return;
    const list = listOf(b.app, listId);
    if (!list) return;
    // Auf einen Seiten-Reiter gezogen: ans Ende dieser Seite.
    const ganzeListe = overId.startsWith("liste:") || overId.startsWith("tab:");
    let index = list.length;
    if (!ganzeListe) {
      index = list.findIndex((x) => x.id === overId);
      const ar = active.rect.current.translated;
      if (ar && index >= 0 && ar.top + ar.height / 2 > over.rect.top + over.rect.height / 2) index += 1;
      if (index < 0) index = list.length;
    }
    if (neu) {
      const nb = makeBlock(neu, b.app);
      b.change((d) => { listOf(d, listId)?.splice(index, 0, structuredClone(nb)); });
      onAdded(nb.id);
      return;
    }
    const srcList = (active.data.current as { sortable?: { containerId?: string } } | undefined)?.sortable?.containerId;
    b.change((d) => {
      const target = listOf(d, listId);
      const loc = locate(d.blocks, activeId);
      if (!target || !loc) return;
      let isInside = false;
      walk([loc.b], (x) => { if (`${x.id}:c` === listId || x.cols?.some((_, i) => `${x.id}:${i}` === listId)) isInside = true; });
      if (isInside) return;
      if (srcList === listId && loc.list === target && !ganzeListe) {
        const overIdx = target.findIndex((x) => x.id === overId);
        const moved = arrayMove(target, loc.i, overIdx);
        target.splice(0, target.length, ...moved);
      } else {
        loc.list.splice(loc.i, 1);
        let i = index;
        if (loc.list === target && loc.i < i) i -= 1;
        target.splice(i, 0, loc.b);
      }
    });
    b.setSel(activeId);
  };

  const label = aktiv ? (aktiv.startsWith("neu:") ? BT[aktiv.slice(4) as BlockType]?.label : (() => { const l = locate(b.app.blocks, aktiv); return l ? BT[l.b.type].label : ""; })()) : "";
  return (
    <DndContext sensors={sensors} collisionDetection={collision} measuring={{ droppable: { strategy: MeasuringStrategy.Always } }} autoScroll={{ threshold: { x: 0, y: 0.12 }, acceleration: 6 }} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => { setAktiv(null); ausgeschlossen.current = new Set(); }}
      accessibility={{ announcements: ankuendigungen, screenReaderInstructions: { draggable: "Leertaste zum Aufnehmen. Pfeiltasten zum Verschieben, Leertaste zum Ablegen, Escape zum Abbrechen. Eingabetaste öffnet die Eigenschaften." } }}>
      {children}
      <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.34, 1.4, 0.64, 1)" }}>
        {aktiv && <div className="drag-ghost">{label}</div>}
      </DragOverlay>
    </DndContext>
  );
}

/* ---------- Seiten ---------- */
function SeitenTab({ p, i, aktiv, onWahl }: { p: Block; i: number; aktiv: boolean; onWahl: () => void }) {
  // Reiter sind Ablagestellen: Ein Baustein, der auf einen Reiter gezogen wird, wandert auf diese Seite.
  const { setNodeRef, isOver } = useDroppable({ id: `tab:${p.id}`, data: { listId: `${p.id}:c` } });
  return (
    <button ref={setNodeRef} type="button" role="tab" aria-selected={aktiv} className="s-tab" data-over={isOver} onClick={onWahl}
      title={aktiv ? "Eigenschaften der Seite zeigen" : "Zu dieser Seite wechseln. Bausteine können auf den Reiter gezogen werden."}>
      <span className="s-no" aria-hidden="true">{i + 1}</span><span className="s-name">{seitenTitel(p, i)}</span>
    </button>
  );
}

export function SeitenLeiste({ b, seite, onSeite, onNeu }: { b: Builder; seite: number; onSeite: (i: number) => void; onNeu: () => void }) {
  const seiten = seitenVon(b.app);
  return (
    <div className="s-bar">
      <div className="s-tabs" role="tablist" aria-label="Seiten der Applikation">
        {seiten.map((p, i) => <SeitenTab key={p.id} p={p} i={i} aktiv={i === seite} onWahl={() => { onSeite(i); b.setSel(p.id); }} />)}
      </div>
      <button type="button" className="s-add" onClick={onNeu} title="Neue Seite hinter der aktuellen einfügen"><Plus size={14} aria-hidden="true" />Seite</button>
    </div>
  );
}

export function Canvas({ b, seite, onDelete, onFocusProp }: { b: Builder; seite: number; onDelete: (id: string) => void; onFocusProp: (id: string) => void }) {
  const ctx = useMemo<EditCtx>(() => ({ b, onDelete, onFocusProp }), [b, onDelete, onFocusProp]);
  const p = seitenVon(b.app)[seite];
  const buehne = useRef<HTMLDivElement>(null);
  const [zuLang, setZuLang] = useState(false);
  // Hinweis, wenn eine Seite nicht mehr auf den Bildschirm passt: Dann sollte sie aufgeteilt werden.
  useEffect(() => {
    const el = buehne.current;
    if (!el) return;
    const pruefen = () => setZuLang(el.scrollHeight > el.clientHeight + 8);
    const ro = new ResizeObserver(pruefen);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    pruefen();
    return () => ro.disconnect();
  }, [p?.id]);
  if (!p) return null;
  return (
    <div className="stage innen-scroll" ref={buehne} onClick={() => b.setSel(null)}
      onKeyDown={(e) => {
        if (!b.sel || (e.target as HTMLElement).closest("input,textarea,select")) return;
        if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onDelete(b.sel); }
        if (e.key === "Escape") b.setSel(null);
      }}>
      <div className="app-frame" style={themeStyle(b.app.theme)}>
        <div className="app-inner">
          <EditList blocks={p.children ?? []} listId={`${p.id}:c`} ctx={ctx} />
        </div>
      </div>
      {zuLang && <p className="s-lang" role="status">Diese Seite ist höher als der Bildschirm. Verschieb einen Teil auf eine neue Seite, dann muss niemand scrollen.</p>}
    </div>
  );
}
