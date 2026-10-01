package wfclient

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
)

// Tasks: the approval inbox and the hands on a task (admin plan §7.3
// "Tasks", §9.4), under the workflows:tasks scope. The app is the door: it
// verified the person's Accounts token and names them as the actor; core is
// the second lock and refuses anybody who is not a current assignee. Every
// acting call therefore names a person, never the app.
//
// Refusals arrive as *Error with these codes: 403 not_an_assignee,
// self_approval, acting_refused; 409 task_closed, subject_changed,
// permits_stale, already_decided, claimed, nothing_to_escalate; 422
// invalid_decision, no_delegation, delegate_not_allowed; 503 unavailable.
// contract/tasks/refusals.json pins them.

// TaskAssignee is one person a task waits for (or waited for).
type TaskAssignee struct {
	Email         string  `json:"email"`
	Sub           string  `json:"sub,omitempty"`
	Name          string  `json:"name,omitempty"`
	Source        string  `json:"source"` // named | role | permission | derived | escalation | delegated
	SourceDetail  string  `json:"source_detail,omitempty"`
	State         string  `json:"state"` // pending | approved | rejected | removed
	AddedAt       string  `json:"added_at"`
	RemovedAt     *string `json:"removed_at,omitempty"`
	RemovedReason string  `json:"removed_reason,omitempty"`
	NotifiedAt    *string `json:"notified_at,omitempty"`
	RemindedCount int     `json:"reminded_count"`
}

// TaskDecision is one row of the append-only decision record.
type TaskDecision struct {
	Actor          Actor  `json:"actor"`
	Decision       string `json:"decision"` // approve | reject | complete | delegate | reassign
	Note           string `json:"note,omitempty"`
	PermitsVersion int64  `json:"permits_version"`
	SubjectSHA256  string `json:"subject_sha256,omitempty"`
	CreatedAt      string `json:"created_at"`
}

// TaskCounts is a task's tally against its mode.
type TaskCounts struct {
	Counted  int `json:"counted"`
	Approved int `json:"approved"`
	Rejected int `json:"rejected"`
	Pending  int `json:"pending"`
	Needed   int `json:"needed"`
}

// TaskStep names the step a task belongs to.
type TaskStep struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

// Task is one task as core answers it (contract/tasks/task.json).
type Task struct {
	UID             string         `json:"uid"`
	RunUID          string         `json:"run_uid"`
	RunState        string         `json:"run_state"`
	Tenant          string         `json:"tenant"`
	Property        string         `json:"property"`
	Kind            string         `json:"kind"`
	TaskType        string         `json:"task_type"` // approval | review | form
	Title           string         `json:"title"`
	Status          string         `json:"status"` // open | completed | cancelled
	Outcome         string         `json:"outcome"`
	Mode            string         `json:"mode"` // any | all | quorum
	Quorum          int            `json:"quorum"`
	RejectMode      string         `json:"reject_mode"`
	AllowSelf       bool           `json:"allow_self"`
	SelfIfSole      bool           `json:"self_if_sole"`
	Delegation      string         `json:"delegation"`
	Unassignable    bool           `json:"unassignable"`
	DueAt           *string        `json:"due_at"`
	EscalationLevel int            `json:"escalation_level"`
	Escalations     int            `json:"escalations"`
	PermitsVersion  int64          `json:"permits_version"`
	Step            TaskStep       `json:"step"`
	Subject         SubjectRef     `json:"subject"`
	Submitter       Actor          `json:"submitter"`
	ClaimedBy       *Actor         `json:"claimed_by"`
	ClaimedAt       *string        `json:"claimed_at"`
	Counts          TaskCounts     `json:"counts"`
	Assignees       []TaskAssignee `json:"assignees"`
	Decisions       []TaskDecision `json:"decisions,omitempty"`
	MayDecide       *bool          `json:"may_decide,omitempty"`
	WhyNot          string         `json:"why_not,omitempty"`
	CreatedAt       string         `json:"created_at"`
	CompletedAt     *string        `json:"completed_at"`
}

// TaskFilter narrows the inbox. Assignee is required unless All — "everything
// in this organisation", which the APP must only offer to whoever holds the
// organisation-wide manage permission.
type TaskFilter struct {
	Tenant      string
	Assignee    string
	All         bool
	Kind        string
	TaskType    string
	Status      string
	App         string
	SubjectType string
	SubjectPID  string
	Cursor      string
	Limit       int
}

// Decide is the body of POST /tasks/{uid}/decide (contract/tasks/decide-request.json).
type Decide struct {
	Actor          Actor  `json:"actor"`
	Decision       string `json:"decision"` // approve | reject
	Note           string `json:"note,omitempty"`
	PermitsVersion int64  `json:"permits_version"`
	SubjectSHA256  string `json:"subject_sha256,omitempty"`
}

// Completion is the body of POST /tasks/{uid}/complete, for a review or form.
type Completion struct {
	Actor          Actor  `json:"actor"`
	Outcome        string `json:"outcome,omitempty"`
	AnswersRef     string `json:"answers_ref,omitempty"`
	AnswersSHA256  string `json:"answers_sha256,omitempty"`
	PermitsVersion int64  `json:"permits_version,omitempty"`
}

// TaskPerson is somebody added to a task.
type TaskPerson struct {
	Email string `json:"email"`
	Name  string `json:"name,omitempty"`
	Sub   string `json:"sub,omitempty"`
}

// ListTasks is the inbox, oldest waiting first.
func (c *Client) ListTasks(ctx context.Context, f TaskFilter) ([]Task, Page, error) {
	q := url.Values{"tenant": {f.Tenant}}
	for k, v := range map[string]string{"assignee": f.Assignee, "kind": f.Kind, "task_type": f.TaskType, "status": f.Status,
		"app": f.App, "subject_type": f.SubjectType, "subject_pid": f.SubjectPID, "cursor": f.Cursor} {
		if v != "" {
			q.Set(k, v)
		}
	}
	if f.All {
		q.Set("all", "true")
	}
	if f.Limit > 0 {
		q.Set("limit", strconv.Itoa(f.Limit))
	}
	var out struct {
		Tasks []Task `json:"tasks"`
		Page
	}
	_, err := c.call(ctx, http.MethodGet, "/api/workflows/tasks", q, nil, nil, &out)
	return out.Tasks, out.Page, err
}

// GetTask reads one task; as, when given, answers MayDecide and WhyNot for
// that person.
func (c *Client) GetTask(ctx context.Context, uid, as string) (Task, error) {
	q := url.Values{}
	if as != "" {
		q.Set("as", as)
	}
	var out Task
	_, err := c.call(ctx, http.MethodGet, "/api/workflows/tasks/"+url.PathEscape(uid), q, nil, nil, &out)
	return out, err
}

func (c *Client) taskAction(ctx context.Context, uid, verb, idempotencyKey string, body any) (Task, error) {
	var out Task
	var headers map[string]string
	if idempotencyKey != "" {
		headers = idem(idempotencyKey)
	}
	_, err := c.call(ctx, http.MethodPost, "/api/workflows/tasks/"+url.PathEscape(uid)+"/"+verb, nil, headers, body, &out)
	return out, err
}

// DecideTask approves or rejects. The key makes a retry a replay.
func (c *Client) DecideTask(ctx context.Context, uid string, d Decide, idempotencyKey string) (Task, error) {
	return c.taskAction(ctx, uid, "decide", idempotencyKey, d)
}

// CompleteTask finishes a review or a form.
func (c *Client) CompleteTask(ctx context.Context, uid string, in Completion, idempotencyKey string) (Task, error) {
	return c.taskAction(ctx, uid, "complete", idempotencyKey, in)
}

// ClaimTask marks a task as being looked at (advisory); release lets it go.
func (c *Client) ClaimTask(ctx context.Context, uid string, actor Actor, release bool) (Task, error) {
	verb := "claim"
	if release {
		verb = "release"
	}
	return c.taskAction(ctx, uid, verb, "", map[string]any{"actor": actor})
}

// DelegateTask hands the actor's place to somebody else, when the step allows.
func (c *Client) DelegateTask(ctx context.Context, uid string, actor Actor, to TaskPerson, note, idempotencyKey string) (Task, error) {
	return c.taskAction(ctx, uid, "delegate", idempotencyKey, map[string]any{"actor": actor, "to": to, "note": note})
}

// ReassignTask is an administrator's hand; the APP checks the actor may
// manage the flow. A reason is required.
func (c *Client) ReassignTask(ctx context.Context, uid string, actor Actor, add []TaskPerson, remove []string, reason, idempotencyKey string) (Task, error) {
	return c.taskAction(ctx, uid, "reassign", idempotencyKey, map[string]any{"actor": actor, "add": add, "remove": remove, "reason": reason})
}

// EscalateTask applies the next escalation level now.
func (c *Client) EscalateTask(ctx context.Context, uid string, actor Actor, reason, idempotencyKey string) (Task, error) {
	return c.taskAction(ctx, uid, "escalate", idempotencyKey, map[string]any{"actor": actor, "reason": reason})
}

// RemindTask reminds the people still owing a decision (once an hour each).
func (c *Client) RemindTask(ctx context.Context, uid string) (Task, error) {
	return c.taskAction(ctx, uid, "remind", "", map[string]any{})
}
