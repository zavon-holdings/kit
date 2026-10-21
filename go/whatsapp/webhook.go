package whatsapp

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"
)

// The callbacks.
//
// Meta posts when a template's review finishes, when a number's quality
// changes, when a message is delivered, read or fails, and when somebody
// writes to the number. The signature is the whole security model: the
// endpoint has no session, and anything that can post to it could otherwise
// write somebody else's receipts or opt somebody out. So an unsigned, wrongly
// signed or unverifiable body is refused, and with no app secret everything is.

// VerifySignature reports whether a body really came from Meta: the header
// is "sha256=<hex HMAC-SHA256 of the raw body with the app secret>",
// compared in constant time.
func VerifySignature(appSecret string, body []byte, header string) bool {
	if strings.TrimSpace(appSecret) == "" {
		return false
	}
	presented, ok := strings.CutPrefix(strings.ToLower(strings.TrimSpace(header)), "sha256=")
	if !ok || presented == "" {
		return false
	}
	want := hmac.New(sha256.New, []byte(appSecret))
	want.Write(body)
	return hmac.Equal([]byte(presented), []byte(hex.EncodeToString(want.Sum(nil))))
}

// Challenge is Meta's verification handshake: a GET with the token we gave
// them and a challenge to echo. An empty token, a wrong mode or a wrong token
// all answer false.
func Challenge(verifyToken, mode, presented, challenge string) (string, bool) {
	if strings.TrimSpace(verifyToken) == "" || mode != "subscribe" {
		return "", false
	}
	if !hmac.Equal([]byte(presented), []byte(verifyToken)) {
		return "", false
	}
	return challenge, true
}

// Event kinds.
const (
	EventTemplateStatus = "template_status"
	EventNumberQuality  = "number_quality"
	EventAccount        = "account"
	EventMessageStatus  = "message_status"
	EventMessageIn      = "message_in"
)

// Event is one thing Meta is telling us, flattened out of its envelope
// (entries of changes of values).
type Event struct {
	Kind string
	// WABAID is the WhatsApp Business Account the callback concerns.
	WABAID string
	// PhoneNumberID is the business number, where the callback names one.
	PhoneNumberID string

	// Template facts.
	TemplateName     string
	TemplateLanguage string
	TemplateID       string
	TemplateStatus   string
	TemplateReason   string

	// Number facts.
	Quality string

	// Message status facts.
	MessageID     string
	MessageStatus string // sent, delivered, read, failed
	Recipient     string
	FailureCode   int
	FailureReason string

	// An incoming message.
	From string // the sender's wa_id: digits, no +
	Name string // the sender's WhatsApp profile name
	Type string // text, button, interactive, image, …
	Text string // a text's body, or a button's text
	// Payload is a quick-reply button's payload, or an interactive reply's id.
	Payload string
	// Context is the message this one replies to, when it does.
	Context   string
	Timestamp int64
}

type envelope struct {
	Object string `json:"object"`
	Entry  []struct {
		ID      string `json:"id"`
		Changes []struct {
			Field string          `json:"field"`
			Value json.RawMessage `json:"value"`
		} `json:"changes"`
	} `json:"entry"`
}

type messagesValue struct {
	Metadata struct {
		PhoneNumberID string `json:"phone_number_id"`
	} `json:"metadata"`
	Contacts []struct {
		WaID    string `json:"wa_id"`
		Profile struct {
			Name string `json:"name"`
		} `json:"profile"`
	} `json:"contacts"`
	Statuses []struct {
		ID        string `json:"id"`
		Status    string `json:"status"`
		Recipient string `json:"recipient_id"`
		Errors    []struct {
			Code  int    `json:"code"`
			Title string `json:"title"`
		} `json:"errors"`
	} `json:"statuses"`
	Messages []struct {
		ID        string `json:"id"`
		From      string `json:"from"`
		Timestamp string `json:"timestamp"`
		Type      string `json:"type"`
		Text      struct {
			Body string `json:"body"`
		} `json:"text"`
		Button struct {
			Text    string `json:"text"`
			Payload string `json:"payload"`
		} `json:"button"`
		Interactive struct {
			Type        string `json:"type"`
			ButtonReply struct {
				ID    string `json:"id"`
				Title string `json:"title"`
			} `json:"button_reply"`
			ListReply struct {
				ID    string `json:"id"`
				Title string `json:"title"`
			} `json:"list_reply"`
		} `json:"interactive"`
		Context struct {
			ID string `json:"id"`
		} `json:"context"`
	} `json:"messages"`
}

// Parse turns a callback body into the facts it carries. An unknown field is
// skipped rather than failing the callback: Meta adds fields, and an endpoint
// that refuses one it does not know stops receiving the ones it does.
func Parse(body []byte) ([]Event, error) {
	var env envelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, err
	}
	var out []Event
	for _, entry := range env.Entry {
		for _, change := range entry.Changes {
			switch change.Field {
			case "message_template_status_update":
				var v struct {
					Event             string `json:"event"`
					MessageTemplateID any    `json:"message_template_id"`
					Name              string `json:"message_template_name"`
					Language          string `json:"message_template_language"`
					Reason            string `json:"reason"`
				}
				if json.Unmarshal(change.Value, &v) != nil {
					continue
				}
				out = append(out, Event{
					Kind: EventTemplateStatus, WABAID: entry.ID,
					TemplateName: v.Name, TemplateLanguage: v.Language,
					TemplateID:     idString(v.MessageTemplateID),
					TemplateStatus: strings.ToUpper(v.Event),
					TemplateReason: v.Reason,
				})
			case "phone_number_quality_update":
				var v struct {
					Event         string `json:"event"`
					PhoneNumberID string `json:"phone_number_id"`
					QualityScore  string `json:"quality_score"`
				}
				if json.Unmarshal(change.Value, &v) != nil {
					continue
				}
				quality := v.QualityScore
				if quality == "" {
					quality = v.Event
				}
				out = append(out, Event{
					Kind: EventNumberQuality, WABAID: entry.ID,
					PhoneNumberID: v.PhoneNumberID, Quality: strings.ToUpper(quality),
				})
			case "account_update":
				var v struct {
					Event         string `json:"event"`
					PhoneNumberID string `json:"phone_number"`
				}
				if json.Unmarshal(change.Value, &v) != nil {
					continue
				}
				out = append(out, Event{
					Kind: EventAccount, WABAID: entry.ID,
					PhoneNumberID: v.PhoneNumberID, TemplateStatus: strings.ToUpper(v.Event),
				})
			case "messages":
				var v messagesValue
				if json.Unmarshal(change.Value, &v) != nil {
					continue
				}
				for _, st := range v.Statuses {
					e := Event{
						Kind: EventMessageStatus, WABAID: entry.ID,
						PhoneNumberID: v.Metadata.PhoneNumberID,
						MessageID:     st.ID, MessageStatus: strings.ToLower(st.Status),
						Recipient: st.Recipient,
					}
					if len(st.Errors) > 0 {
						e.FailureCode, e.FailureReason = st.Errors[0].Code, st.Errors[0].Title
					}
					out = append(out, e)
				}
				names := map[string]string{}
				for _, c := range v.Contacts {
					names[c.WaID] = c.Profile.Name
				}
				for _, m := range v.Messages {
					e := Event{
						Kind: EventMessageIn, WABAID: entry.ID,
						PhoneNumberID: v.Metadata.PhoneNumberID,
						MessageID:     m.ID, From: Digits(m.From), Name: names[m.From],
						Type: m.Type, Context: m.Context.ID,
					}
					e.Timestamp, _ = strconv.ParseInt(m.Timestamp, 10, 64)
					switch m.Type {
					case "text":
						e.Text = m.Text.Body
					case "button":
						e.Text, e.Payload = m.Button.Text, m.Button.Payload
					case "interactive":
						if m.Interactive.ButtonReply.ID != "" {
							e.Text, e.Payload = m.Interactive.ButtonReply.Title, m.Interactive.ButtonReply.ID
						} else {
							e.Text, e.Payload = m.Interactive.ListReply.Title, m.Interactive.ListReply.ID
						}
					}
					out = append(out, e)
				}
			}
		}
	}
	return out, nil
}

// Keyword reads an incoming text as one of the words a number must honour
// whatever else it does: "stop", "start" or "help", else "". Case, spaces
// and a trailing full stop are ignored; "STOP ALL" and "UNSUBSCRIBE" are
// stop, "UNSTOP" is start. Not "cancel", "end" or "yes": on a number that
// asks people about their tasks those are answers, not instructions.
func Keyword(text string) string {
	t := strings.ToUpper(strings.Join(strings.Fields(strings.Trim(strings.TrimSpace(text), ".!")), " "))
	switch t {
	case "STOP", "STOP ALL", "STOPALL", "UNSUBSCRIBE", "OPT OUT", "OPTOUT":
		return "stop"
	case "START", "UNSTOP", "SUBSCRIBE", "OPT IN", "OPTIN":
		return "start"
	case "HELP", "INFO":
		return "help"
	}
	return ""
}

// idString copes with Meta sending an id as a number in one payload and a
// string in another.
func idString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	}
	return ""
}
