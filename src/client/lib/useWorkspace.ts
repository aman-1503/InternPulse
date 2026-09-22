import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  type ActivityEntry,
  type Attachment,
  type AttentionItem,
  type Blocker,
  type BlockerComment,
  type ClientMessage,
  type Feedback,
  type Mention,
  type PresenceState,
  type ProgressUpdate,
  type Reminder,
  type ServerMessage,
  type Task,
  type TaskPatch,
  type TaskPriority,
  type TaskStatus,
  type UpdateType,
  type WeeklyReport,
  type WorkspaceMember,
  type WorkspaceSnapshot,
} from "../../shared/protocol";
import { WorkspaceSocket, type SocketStatus } from "./workspaceSocket";
import type { WorkspaceMode } from "./workspaceApi";

export interface WorkspaceState {
  status: SocketStatus;
  schemaVersion: number | null;
  you: WorkspaceSnapshot["you"] | null;
  members: WorkspaceMember[];
  tasks: Task[];
  blockers: Blocker[];
  blockerComments: BlockerComment[];
  updates: ProgressUpdate[];
  feedback: Feedback[];
  activity: ActivityEntry[];
  presence: PresenceState;
  reminders: Reminder[];
  attentionItems: AttentionItem[];
  mentions: Mention[];
  attachments: Attachment[];
  weeklyReports: WeeklyReport[];
  lastError: { at: number; message: string; code?: string } | null;
}

const initialState: WorkspaceState = {
  status: "connecting",
  schemaVersion: null,
  you: null,
  members: [],
  tasks: [],
  blockers: [],
  blockerComments: [],
  updates: [],
  feedback: [],
  activity: [],
  presence: { count: 0, members: [] },
  reminders: [],
  attentionItems: [],
  mentions: [],
  attachments: [],
  weeklyReports: [],
  lastError: null,
};

type Action = { kind: "status"; status: SocketStatus } | { kind: "msg"; msg: ServerMessage };

const upsert = <T extends { id: string | number }>(list: T[], item: T): T[] => {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [item, ...list];
  const copy = list.slice();
  copy[i] = item;
  return copy;
};

function reducer(state: WorkspaceState, action: Action): WorkspaceState {
  if (action.kind === "status") return { ...state, status: action.status };
  const msg = action.msg;
  switch (msg.type) {
    case "workspace.snapshot":
      return {
        ...state,
        schemaVersion: msg.schemaVersion,
        you: msg.you,
        members: msg.members,
        tasks: msg.tasks,
        blockers: msg.blockers,
        blockerComments: msg.blockerComments,
        updates: msg.updates,
        feedback: msg.feedback,
        activity: msg.activity,
        presence: msg.presence,
        reminders: msg.reminders,
        attentionItems: msg.attentionItems,
        mentions: msg.mentions,
        attachments: msg.attachments,
        weeklyReports: msg.weeklyReports,
      };
    case "task.created":
      return { ...state, tasks: upsert(state.tasks, msg.task) };
    case "task.updated":
      return { ...state, tasks: upsert(state.tasks, msg.task) };
    case "task.deleted":
      return { ...state, tasks: state.tasks.filter((t) => t.id !== msg.id) };
    case "blocker.created":
      return { ...state, blockers: upsert(state.blockers, msg.blocker) };
    case "blocker.commented":
      return {
        ...state,
        blockers: upsert(state.blockers, msg.blocker),
        blockerComments: upsert(state.blockerComments, msg.comment),
      };
    case "blocker.resolved":
      return { ...state, blockers: upsert(state.blockers, msg.blocker) };
    case "update.created":
      return { ...state, updates: [msg.update, ...state.updates.filter((u) => u.id !== msg.update.id)] };
    case "feedback.created":
      return { ...state, feedback: upsert(state.feedback, msg.feedback) };
    case "activity.created":
      return { ...state, activity: [msg.activity, ...state.activity].slice(0, 150) };
    case "presence.updated":
      return { ...state, presence: msg.presence };
    case "reminder.created":
      return { ...state, reminders: upsert(state.reminders, msg.reminder) };
    case "reminder.updated":
      return { ...state, reminders: upsert(state.reminders, msg.reminder) };
    case "mention.created":
      return { ...state, mentions: upsert(state.mentions, msg.mention) };
    case "attention.updated":
      return { ...state, attentionItems: msg.items };
    case "weekly.updated":
      return { ...state, weeklyReports: upsert(state.weeklyReports, msg.report) };
    case "attachment.created":
    case "attachment.updated":
      return { ...state, attachments: upsert(state.attachments, msg.attachment) };
    case "attachment.deleted":
      return { ...state, attachments: state.attachments.filter((a) => a.id !== msg.id) };
    case "error":
      return { ...state, lastError: { at: Date.now(), message: msg.message, code: msg.code } };
    case "ack":
    case "pong":
      return state;
    default:
      return state;
  }
}

export interface WorkspaceActions {
  createTask: (input: {
    title: string;
    description?: string | null;
    priority?: TaskPriority | null;
    dueDate?: number | null;
    status?: TaskStatus;
  }) => void;
  updateTask: (id: string, patch: TaskPatch) => void;
  moveTask: (id: string, status: TaskStatus) => void;
  deleteTask: (id: string) => void;
  setTaskPriority: (id: string, priority: TaskPriority) => void;
  createBlocker: (description: string, taskId?: string | null) => void;
  commentOnBlocker: (id: string, content: string) => void;
  requestBlockerResolution: (id: string) => void;
  resolveBlocker: (id: string, note: string) => void;
  escalateBlocker: (id: string, note?: string | null) => void;
  postUpdate: (content: string, updateType?: UpdateType) => void;
  postFeedback: (content: string, taskId?: string | null) => void;
}

export function useWorkspace(
  workspaceId: string,
  mode: WorkspaceMode,
): WorkspaceState & { actions: WorkspaceActions } {
  const [state, dispatch] = useReducer(reducer, initialState);
  const socketRef = useRef<WorkspaceSocket | null>(null);

  useEffect(() => {
    const socket = new WorkspaceSocket({
      workspaceId,
      mode,
      onMessage: (msg) => dispatch({ kind: "msg", msg }),
      onStatusChange: (status) => dispatch({ kind: "status", status }),
    });
    socketRef.current = socket;
    socket.connect();
    return () => socket.close();
    // Identity/role changes remount this hook via `key` on the workspace view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const send = useCallback((msg: ClientMessage) => socketRef.current?.send(msg), []);
  const rid = () => crypto.randomUUID();

  const actions = useMemo<WorkspaceActions>(
    () => ({
      createTask: (input) =>
        send({
          type: "task.create",
          requestId: rid(),
          title: input.title,
          description: input.description ?? null,
          priority: input.priority ?? null,
          dueDate: input.dueDate ?? null,
          status: input.status,
        }),
      updateTask: (id, patch) => send({ type: "task.update", requestId: rid(), id, patch }),
      moveTask: (id, status) => send({ type: "task.move", requestId: rid(), id, status }),
      deleteTask: (id) => send({ type: "task.delete", requestId: rid(), id }),
      setTaskPriority: (id, priority) => send({ type: "task.priority", requestId: rid(), id, priority }),
      createBlocker: (description, taskId) =>
        send({ type: "blocker.create", requestId: rid(), description, taskId: taskId ?? null }),
      commentOnBlocker: (id, content) => send({ type: "blocker.comment", requestId: rid(), id, content }),
      requestBlockerResolution: (id) => send({ type: "blocker.requestResolution", requestId: rid(), id }),
      resolveBlocker: (id, note) => send({ type: "blocker.resolve", requestId: rid(), id, note }),
      escalateBlocker: (id, note) => send({ type: "blocker.escalate", requestId: rid(), id, note: note ?? null }),
      postUpdate: (content, updateType) =>
        send({ type: "update.create", requestId: rid(), content, updateType }),
      postFeedback: (content, taskId) =>
        send({ type: "feedback.create", requestId: rid(), content, taskId: taskId ?? null }),
    }),
    [send],
  );

  return { ...state, actions };
}
