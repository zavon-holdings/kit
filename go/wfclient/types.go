// Package wfclient is the Go client for core's workflow API,
// /api/workflows/* (admin/docs/workflow-engine-plan.md §7).
//
// It speaks wire version 1 (Zavon-Workflow-Version: 1) and mirrors the types
// core's handlers read and write. Nothing here decides anything: a client
// sends what it is given and reports what came back, in the shapes below.
//
// Every write that creates or decides something carries an Idempotency-Key.
// The same key with the same body is replayed by core and reported here as
// Replayed; the same key with another body is refused (422
// idempotency_key_reused). Errors carry core's code so a caller can act on
// it, and IsUnavailable tells "core did not decide" (retry) from "core said
// no" (do not).
package wfclient

import (
	"encoding/json"
	"time"
)

// WireVersion is the workflow wire this client speaks.
const WireVersion = "1"

// SubjectRef is what a run is about, as its owner names it (§5).
type SubjectRef struct {
	Property string            `json:"property"`
	Type     string            `json:"type"`
	PID      string            `json:"pid"`
	Label    string            `json:"label,omitempty"`
	URL      string            `json:"url,omitempty"`
	Vars     map[string]string `json:"vars,omitempty"`
}

// Actor is who did something: a person the app authenticated, the app, or
// core itself (§5).
type Actor struct {
	Kind     string  `json:"kind,omitempty"` // user | app | system
	Sub      string  `json:"sub,omitempty"`
	Email    string  `json:"email,omitempty"`
	Name     string  `json:"name,omitempty"`
	Property string  `json:"property,omitempty"`
	Acting   *Acting `json:"acting,omitempty"`
}

// Acting is the real person behind an acting session.
type Acting struct {
	RealEmail string `json:"real_email"`
}

// Condition is one clause of a trigger's filter: field is / is_not value.
type Condition struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value string `json:"value"`
}

// TriggerInput is a definition's trigger.
type TriggerInput struct {
	Kind           string      `json:"kind"`
	EventType      string      `json:"event_type,omitempty"`
	CronExpression string      `json:"cron_expression,omitempty"`
	SubjectKind    string      `json:"subject_kind,omitempty"`
	SubjectVar     string      `json:"subject_var,omitempty"`
	SubjectType    string      `json:"subject_type,omitempty"`
	Conditions     []Condition `json:"conditions,omitempty"`
	DateVar        string      `json:"date_var,omitempty"`
	DateOffsetDays int         `json:"date_offset_days,omitempty"`
	DateRecurs     bool        `json:"date_recurs,omitempty"`
	OncePerSubject bool        `json:"once_per_subject,omitempty"`
	// Reads is the trigger in words, answered by core. Read-only.
	Reads string `json:"reads,omitempty"`
}

// StepInput is one step as written.
type StepInput struct {
	Code   string          `json:"code"`
	Name   string          `json:"name"`
	Kind   string          `json:"kind"`
	Config json.RawMessage `json:"config,omitempty"`
	Parent string          `json:"parent,omitempty"`
	Branch string          `json:"branch,omitempty"`
}

// DefinitionInput is a definition as written: the body of POST and PUT
// /definitions, with the actor beside it.
type DefinitionInput struct {
	Tenant      string       `json:"tenant"`
	Kind        string       `json:"kind,omitempty"`
	Code        string       `json:"code"`
	Name        string       `json:"name"`
	Description string       `json:"description,omitempty"`
	Active      *bool        `json:"active,omitempty"`
	Steps       []StepInput  `json:"steps"`
	Trigger     TriggerInput `json:"trigger"`
	Actor       *Actor       `json:"actor,omitempty"`
}

// StepView is one stored step.
type StepView struct {
	Code   string          `json:"code"`
	Name   string          `json:"name"`
	Kind   string          `json:"kind"`
	Stored string          `json:"stored_kind"`
	Config json.RawMessage `json:"config"`
	Parent string          `json:"parent,omitempty"`
	Branch string          `json:"branch,omitempty"`
	Order  int             `json:"order"`
}

// VersionView is one version's row.
type VersionView struct {
	Version   int       `json:"version"`
	Checksum  string    `json:"checksum"`
	Note      string    `json:"note,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// Definition is a definition as core answers it. ETag is what a save sends
// back as If-Match.
type Definition struct {
	UID               string         `json:"uid"`
	Tenant            string         `json:"tenant"`
	Kind              string         `json:"kind"`
	Code              string         `json:"code"`
	Name              string         `json:"name"`
	Description       string         `json:"description"`
	Active            bool           `json:"active"`
	Archived          bool           `json:"archived"`
	IsTemplate        bool           `json:"is_template"`
	TemplateCode      string         `json:"template_code,omitempty"`
	CurrentVersion    int            `json:"current_version"`
	Checksum          string         `json:"checksum"`
	Steps             []StepView     `json:"steps,omitempty"`
	Trigger           *TriggerInput  `json:"trigger,omitempty"`
	Versions          []VersionView  `json:"versions,omitempty"`
	LiveRunsByVersion map[string]int `json:"live_runs_by_version,omitempty"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
	ETag              string         `json:"etag"`
}

// Saved is what PUT /definitions/{uid} answers.
type Saved struct {
	Definition     Definition     `json:"definition"`
	Version        int            `json:"version"`
	Versioned      bool           `json:"versioned"`
	LiveOnPrevious map[string]int `json:"live_on_previous"`
}

// Problem is one thing wrong with a definition (§8.6).
type Problem struct {
	Step    string `json:"step,omitempty"`
	Field   string `json:"field,omitempty"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// DefinitionFilter narrows GET /definitions.
type DefinitionFilter struct {
	Tenant           string
	Kind             string
	IncludeTemplates bool
	IncludeArchived  bool
	Cursor           string
	Limit            int
}

// Page is the cursor a listing hands back; empty means the last page.
type Page struct {
	NextCursor string `json:"next_cursor"`
}

// StartRun is the body of POST /runs. Exactly one of Definition (a uid or a
// code in the tenant) and Select ("auto": the most specific approval flow
// that applies, by binding — core v3 of the plan) is given.
type StartRun struct {
	Tenant     string         `json:"tenant"`
	Definition string         `json:"definition,omitempty"`
	Select     string         `json:"select,omitempty"`
	Kind       string         `json:"kind,omitempty"`
	Subject    SubjectRef     `json:"subject"`
	Vars       map[string]any `json:"vars,omitempty"`
	Actor      *Actor         `json:"actor,omitempty"`
}

// RunSummary is one run in a listing.
type RunSummary struct {
	UID            string     `json:"uid"`
	Tenant         string     `json:"tenant"`
	Kind           string     `json:"kind"`
	Definition     string     `json:"definition"`
	DefinitionCode string     `json:"definition_code"`
	Version        int        `json:"version"`
	Subject        SubjectRef `json:"subject"`
	State          string     `json:"state"`
	Outcome        string     `json:"outcome,omitempty"`
	PauseReason    string     `json:"pause_reason,omitempty"`
	StartedAt      time.Time  `json:"started_at"`
	CompletedAt    *time.Time `json:"completed_at,omitempty"`
	CancelledAt    *time.Time `json:"cancelled_at,omitempty"`
}

// RunStep is one step of a run, with where the run is on it.
type RunStep struct {
	Code        string         `json:"code"`
	Name        string         `json:"name"`
	Kind        string         `json:"kind"`
	Parent      string         `json:"parent,omitempty"`
	Branch      string         `json:"branch,omitempty"`
	Status      string         `json:"status"`
	SkipReason  string         `json:"skip_reason,omitempty"`
	EnteredAt   *time.Time     `json:"entered_at,omitempty"`
	CompletedAt *time.Time     `json:"completed_at,omitempty"`
	Output      map[string]any `json:"output,omitempty"`
	Stage       bool           `json:"stage,omitempty"`
}

// PendingJob is what is booked for a run, and when.
type PendingJob struct {
	Kind  string    `json:"kind"`
	Due   time.Time `json:"due"`
	State string    `json:"state"`
}

// Run is one run as GET /runs/{uid} answers it.
type Run struct {
	RunSummary
	Vars        map[string]any `json:"vars"`
	Stage       string         `json:"stage,omitempty"`
	Steps       []RunStep      `json:"steps"`
	PendingJobs []PendingJob   `json:"pending_jobs"`
	Tasks       []any          `json:"tasks"`
}

// RunFilter narrows GET /runs.
type RunFilter struct {
	Tenant      string
	Kind        string
	Definition  string
	State       string
	SubjectType string
	SubjectPID  string
	Cursor      string
	Limit       int
}

// Entry is one line of a run's timeline.
type Entry struct {
	UID       string          `json:"uid"`
	Kind      string          `json:"kind"`
	Actor     Actor           `json:"actor"`
	Title     string          `json:"title"`
	Body      string          `json:"body,omitempty"`
	Detail    json.RawMessage `json:"detail,omitempty"`
	MessageID string          `json:"message_id,omitempty"`
	OpenedAt  *time.Time      `json:"opened_at,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
}

// Delivery is one call core made to an app.
type Delivery struct {
	UID            string          `json:"uid"`
	Property       string          `json:"property"`
	Action         string          `json:"action"`
	IdempotencyKey string          `json:"idempotency_key"`
	Attempt        int             `json:"attempt"`
	Status         string          `json:"status"`
	Request        json.RawMessage `json:"request,omitempty"`
	ResponseStatus *int            `json:"response_status,omitempty"`
	ResponseBody   string          `json:"response_body,omitempty"`
	LatencyMS      *int            `json:"latency_ms,omitempty"`
	CreatedAt      time.Time       `json:"created_at"`
	FinishedAt     *time.Time      `json:"finished_at,omitempty"`
}

// Timeline is GET /runs/{uid}/timeline.
type Timeline struct {
	Entries    []Entry    `json:"entries"`
	Deliveries []Delivery `json:"deliveries"`
}

// Migration is what a migrate (single or bulk, dry or not) reports per run.
type Migration struct {
	Run         string      `json:"run,omitempty"`
	DryRun      bool        `json:"dry_run"`
	FromVersion int         `json:"from_version"`
	ToVersion   int         `json:"to_version"`
	Kept        []string    `json:"kept"`
	New         []StepBrief `json:"new"`
	LeftBehind  []string    `json:"left_behind"`
	NowAt       string      `json:"now_at"`
	Says        string      `json:"says"`
	Error       string      `json:"error,omitempty"`
}

// StepBrief is a step named for a person.
type StepBrief struct {
	Code string `json:"code"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

// BulkMigration is POST /runs/migrate.
type BulkMigration struct {
	DryRun   bool        `json:"dry_run"`
	Migrated int         `json:"migrated"`
	Results  []Migration `json:"results"`
}

// Transferred is what POST /runs/{uid}/transfer answers.
type Transferred struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Stage string `json:"stage,omitempty"`
	Sends bool   `json:"sends"`
}

// BoardColumn is one stage of a definition's current version.
type BoardColumn struct {
	Code  string `json:"code"`
	Name  string `json:"name"`
	Owner string `json:"owner,omitempty"`
	Sends bool   `json:"sends"`
	Asks  string `json:"asks,omitempty"`
}

// BoardCard is one live run in a column.
type BoardCard struct {
	Run          string     `json:"run"`
	Subject      SubjectRef `json:"subject"`
	Stage        string     `json:"stage"`
	Version      int        `json:"version"`
	State        string     `json:"state"`
	PauseReason  string     `json:"pause_reason,omitempty"`
	SnoozedUntil *time.Time `json:"snoozed_until,omitempty"`
	Owner        string     `json:"owner,omitempty"`
	MovedAt      time.Time  `json:"moved_at"`
	JoinedAt     time.Time  `json:"joined_at"`
	Overdue      bool       `json:"overdue,omitempty"`
	LastEvent    string     `json:"last_event,omitempty"`
	LastEmail    string     `json:"last_email,omitempty"`
}

// Board is GET /definitions/{uid}/board.
type Board struct {
	Columns  []BoardColumn `json:"columns"`
	Cards    []BoardCard   `json:"cards"`
	Finished int           `json:"finished"`
}

// Manifest is what an app registers (§8.4).
type Manifest struct {
	Namespace    string            `json:"namespace"`
	Version      string            `json:"version"`
	BaseURL      string            `json:"base_url"`
	SubjectTypes []json.RawMessage `json:"subject_types,omitempty"`
	Events       []ManifestEvent   `json:"events,omitempty"`
	Actions      []ManifestAction  `json:"actions,omitempty"`
	Hooks        []string          `json:"hooks,omitempty"`
}

// ManifestEvent is one event an app posts.
type ManifestEvent struct {
	Type      string            `json:"type"`
	Label     string            `json:"label,omitempty"`
	Shareable bool              `json:"shareable,omitempty"`
	Subject   string            `json:"subject,omitempty"`
	Vars      map[string]string `json:"vars,omitempty"`
}

// ManifestAction is one action an app answers.
type ManifestAction struct {
	Name        string          `json:"name"`
	Path        string          `json:"path,omitempty"`
	Mode        string          `json:"mode,omitempty"` // sync | async
	TimeoutMS   int             `json:"timeout_ms,omitempty"`
	MaxAttempts int             `json:"max_attempts,omitempty"`
	ActionKind  string          `json:"action_kind,omitempty"` // step | resolver | hook
	Callers     []string        `json:"callers,omitempty"`
	Kinds       []string        `json:"kinds,omitempty"`
	InputSchema json.RawMessage `json:"input_schema,omitempty"`
}

// ManifestStatus is GET /manifest.
type ManifestStatus struct {
	Manifest          *Manifest `json:"manifest"`
	CallbackSecretSet bool      `json:"callback_secret_set"`
}

// RotatedSecret is POST /callback-secret/rotate. The secret is shown ONCE.
type RotatedSecret struct {
	Secret             string    `json:"secret"`
	PreviousValidUntil time.Time `json:"previous_valid_until"`
	Note               string    `json:"note"`
}

// CatalogueEntry is one event a property's definitions may start from.
type CatalogueEntry struct {
	Type      string   `json:"type"`
	Label     string   `json:"label,omitempty"`
	Producer  string   `json:"producer"`
	Subject   string   `json:"subject,omitempty"`
	Vars      []string `json:"vars,omitempty"`
	Shareable bool     `json:"shareable"`
}

// Event is one occurrence a producer posts (§7.3).
type Event struct {
	Type       string         `json:"type"`
	Ref        string         `json:"ref"`
	Tenant     string         `json:"tenant"`
	OccurredAt *time.Time     `json:"occurred_at,omitempty"`
	Subject    *SubjectRef    `json:"subject,omitempty"`
	Vars       map[string]any `json:"vars,omitempty"`
}

// EventResult is what core did with one event.
type EventResult struct {
	EventUID  string `json:"event_uid,omitempty"`
	Matched   int    `json:"matched"`
	Advanced  bool   `json:"advanced"`
	Duplicate bool   `json:"duplicate"`
	// Index and Status are set on a batch result; Error and Code on a
	// refused one.
	Index  int    `json:"index,omitempty"`
	Status int    `json:"status,omitempty"`
	Error  string `json:"error,omitempty"`
	Code   string `json:"code,omitempty"`
}

// Settings is PUT /settings: an organisation's calendar.
type Settings struct {
	Tenant    string            `json:"tenant"`
	Name      string            `json:"name,omitempty"`
	Timezone  string            `json:"timezone,omitempty"`
	Workweek  []int             `json:"workweek,omitempty"`
	WorkHours map[string]string `json:"work_hours,omitempty"`
	Holidays  []string          `json:"holidays,omitempty"`
}
