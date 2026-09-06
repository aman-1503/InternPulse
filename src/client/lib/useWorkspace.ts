import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  type ActivityEntry,
  type Blocker,
  type ClientMessage,
  type Feedback,
  type PresenceState,
  type ProgressUpdate,
  type ServerMessage,
  type Task,
  type TaskPatch,
  type TaskPriority,
  type TaskStatus,
  type UpdateType,
  type WorkspaceSnapshot,
} from "../../shared/protocol";
import { WorkspaceSocket, type SocketStatus } from "./workspaceSocket";

export interface WorkspaceState {
  status: SocketStatus;
  schemaVersion: number | null;
  you: WorkspaceSnapshot["you"] | null;
  tasks: Task[];
  blockers: Blocker[];
  updates: ProgressUpdate[];
  feedback: Feedback[];
  activity: ActivityEntry[];
  presence: PresenceState;
  lastError: { at: number; message: string; code?: string } | null;
}

const initialState: WorkspaceState = {
  status: "connecting",
  schemaVersion: null,
  you: null,
  tasks: [],
  blockers: [],
  updates: [],
  feedback: [],
  activity: [],
  presence: { count: 0, members: [] },
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
        tasks: msg.tasks,
        blockers: msg.blockers,
        updates: msg.updates,
        feedback: msg.feedback,
        activity: msg.activity,
        presence: msg.presence,
      };
    case "task.created":
      return { ...state, tasks: upsert(state.tasks, msg.task) };
    case "task.updated":
      return { ...state, tasks: upsert(state.tasks, msg.task) };
    case "task.deleted":
      return { ...state, tasks: state.tasks.filter((t) => t.id !== msg.id) };
    case "blocker.created":
      return { ...state, blockers: upsert(state.blockers, msg.blocker) };
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
    case "error":
      return { ...state, lastError: { at: Date.now(), message: msg.message, code: msg.code } };
    case "ack":
    case "pong":
      return state;
  }
}

export interface WorkspaceActions {
  createTask: (input: {
    title: string;
    description?: string | null;
    priority?: TaskPriority | null;
    status?: TaskStatus;
  }) => void;
  updateTask: (id: string, patch: TaskPatch) => void;
  moveTask: (id: string, status: TaskStatus) => void;
  deleteTask: (id: string) => void;
  createBlocker: (description: string, taskId?: string | null) => void;
  resolveBlocker: (id: string) => void;
  postUpdate: (content: string, updateType?: UpdateType) => void;
  postFeedback: (content: string, taskId?: string | null) => void;
}

export function useWorkspace(
  workspaceId: string,
  identity: { userId: string; displayName: string },
  devRole: string,
): WorkspaceState & { actions: WorkspaceActions } {
  const [state, dispatch] = useReducer(reducer, initialState);
  const socketRef = useRef<WorkspaceSocket | null>(null);

  useEffect(() => {
    const socket = new WorkspaceSocket({
      workspaceId,
      userId: identity.userId,
      displayName: identity.displayName,
      devRole,
      onMessage: (msg) => dispatch({ kind: "msg", msg }),
      onStatusChange: (status) => dispatch({ kind: "status", status }),
    });
    socketRef.current = socket;
    socket.connect();
    return () => socket.close();
    // Identity/role changes remount this hook via `key` on <Workspace/>.
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
          status: input.status,
        }),
      updateTask: (id, patch) => send({ type: "task.update", requestId: rid(), id, patch }),
      moveTask: (id, status) => send({ type: "task.move", requestId: rid(), id, status }),
      deleteTask: (id) => send({ type: "task.delete", requestId: rid(), id }),
      createBlocker: (description, taskId) =>
        send({ type: "blocker.create", requestId: rid(), description, taskId: taskId ?? null }),
      resolveBlocker: (id) => send({ type: "blocker.resolve", requestId: rid(), id }),
      postUpdate: (content, updateType) =>
        send({ type: "update.create", requestId: rid(), content, updateType }),
      postFeedback: (content, taskId) =>
        send({ type: "feedback.create", requestId: rid(), content, taskId: taskId ?? null }),
    }),
    [send],
  );

  return { ...state, actions };
}
