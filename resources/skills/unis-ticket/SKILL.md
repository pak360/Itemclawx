---
name: unis-ticket
description: Query, search, and manage tickets in the Unis Ticket system via the REST API.
metadata:
  {
    "openclaw":
      {
        "emoji": "🎫",
        "requires": { "bins": ["curl"], "env": ["UNIS_TICKET_TOKEN"] },
        "primaryEnv": "UNIS_TICKET_TOKEN",
      },
  }
---

# unis-ticket

Query and manage tickets in the Unis Ticket system using the REST API.

## Authentication

The `UNIS_TICKET_TOKEN` environment variable is injected automatically when configured through the OpenClaw desktop app. Pass it as the `x-tickets-token` header in all API calls.

**Important:** Always use `curl.exe` (not `curl`) to avoid PowerShell aliasing `curl` to `Invoke-WebRequest` on Windows.

All requests need:

```bash
curl.exe -s -X <METHOD> "https://unisticket.item.com/api/item-tickets/v1/staff/..." \
  -H "x-tickets-token: $env:UNIS_TICKET_TOKEN" \
  -H "User-Agent: ItemClaw-TicketSkill/1.0" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json"
```

## API Base URL

```
https://unisticket.item.com/api/item-tickets
```

## Response Format

All responses follow this structure:

```json
{ "code": 200, "msg": "success", "data": { ... }, "success": true }
```

Check `success === true` before reading `data`.

## Key Endpoints

### Get current user info

Returns the authenticated staff member's details including their `id` (staffId), `name`, `email`, departments, and teams. Always call this first when the user asks about "my" tickets.

```bash
curl.exe -s "https://unisticket.item.com/api/item-tickets/v1/staff/auth/current" \
  -H "x-tickets-token: $env:UNIS_TICKET_TOKEN" \
  -H "User-Agent: ItemClaw-TicketSkill/1.0" \
  -H "x-tickets-timezone: America/Los_Angeles"
```

The `x-tickets-timezone` header is **required** for this endpoint.

### List tickets (paginated)

POST `/v1/staff/tickets/page`

```bash
curl.exe -s -X POST "https://unisticket.item.com/api/item-tickets/v1/staff/tickets/page" \
  -H "x-tickets-token: $env:UNIS_TICKET_TOKEN" \
  -H "User-Agent: ItemClaw-TicketSkill/1.0" \
  -H "Content-Type: application/json" \
  -d '{"page": 1, "size": 10, "input": {}}'
```

The `input` object supports these filters (all optional):

- `staffId` (int64) — filter by assignee staff ID; use to find "my tickets"
- `staffIds` (int64[]) — filter by multiple assignee IDs
- `unassigned` (bool) — show only unassigned tickets
- `displayStatusSystemStatus` (int[]) — filter by system status: `[10]` = open, `[20]` = closed, `[30]` = archived, `[40]` = deleted
- `displayStatusIds` (int64[]) — filter by custom display status IDs
- `displayStatusEnums` (string[]) — filter by enum name: `"Pending"`, `"Solved"`, `"Closed"`
- `departmentIds` (int64[]) — filter by department
- `teamIds` (int64[]) — filter by team
- `topicIds` (int64[]) — filter by topic
- `priorityId` (int64) — filter by priority
- `sourceChannel` (int) — 1:Phone, 2:Email, 3:Web, 4:API, 5:Other, 6:Open Form, 7:Chat Session, 8:AI Assistant, 9:Ticket APP
- `replyStatus` (int) — 1:waiting for answer, 2:answered
- `ticketNumber` (string) — filter by ticket number
- `title` (string) — filter by title
- `createTimeStart`, `createTimeEnd` (string, format `MM/dd/yyyy HH:mm:ss`) — date range filter on creation time
- `updateTimeStart`, `updateTimeEnd` (string, format `MM/dd/yyyy HH:mm:ss`) — date range filter on update time
- `tagIds` (int64[]) — filter by tags
- `ticketIsOverdue` (bool) — show only overdue tickets

Example — list my open tickets:

```bash
curl.exe -s -X POST "https://unisticket.item.com/api/item-tickets/v1/staff/tickets/page" \
  -H "x-tickets-token: $env:UNIS_TICKET_TOKEN" \
  -H "User-Agent: ItemClaw-TicketSkill/1.0" \
  -H "Content-Type: application/json" \
  -d '{"page": 1, "size": 20, "input": {"staffId": 123, "displayStatusSystemStatus": [10]}}'
```

Replace `123` with the user's actual staffId from `/v1/staff/auth/current`.

### Search tickets by keyword

POST `/v1/staff/tickets/search`

```bash
curl.exe -s -X POST "https://unisticket.item.com/api/item-tickets/v1/staff/tickets/search" \
  -H "x-tickets-token: $env:UNIS_TICKET_TOKEN" \
  -H "User-Agent: ItemClaw-TicketSkill/1.0" \
  -H "Content-Type: application/json" \
  -d '{"keyword": "network issue", "size": 10}'
```

Search request fields:

- `keyword` (**required**, string, max 100 chars)
- `size` (optional, int, 1-100, default 10)
- `similaritySearch` (optional, bool) — use semantic similarity
- `includeContent` (optional, bool, default true) — search in content/messages too
- `departmentId`, `staffId`, `teamId`, `topicId`, `customerId`, `organizationId` — optional filters (int64)
- `createTimeFrom`, `createTimeTo` — date filters (format: `MM/dd/yyyy HH:mm:ss`)
- `updateTimeFrom`, `updateTimeTo` — date filters (format: `MM/dd/yyyy HH:mm:ss`)

### Get ticket by ID

GET `/v1/staff/tickets/{id}`

```bash
curl.exe -s "https://unisticket.item.com/api/item-tickets/v1/staff/tickets/123" \
  -H "x-tickets-token: $env:UNIS_TICKET_TOKEN" \
  -H "User-Agent: ItemClaw-TicketSkill/1.0"
```

### Get ticket brief info

GET `/v1/staff/tickets/brief/{id}` — lighter-weight alternative when you only need summary fields.

```bash
curl.exe -s "https://unisticket.item.com/api/item-tickets/v1/staff/tickets/brief/123" \
  -H "x-tickets-token: $env:UNIS_TICKET_TOKEN" \
  -H "User-Agent: ItemClaw-TicketSkill/1.0"
```

### Get ticket by number

GET `/v1/staff/tickets/number/{code}`

```bash
curl.exe -s "https://unisticket.item.com/api/item-tickets/v1/staff/tickets/number/TK-00123" \
  -H "x-tickets-token: $env:UNIS_TICKET_TOKEN" \
  -H "User-Agent: ItemClaw-TicketSkill/1.0"
```

### Get ticket timeline

POST `/v1/staff/tickets/{ticketId}/timeline`

Returns messages and audit log entries for a ticket.

```bash
curl.exe -s -X POST "https://unisticket.item.com/api/item-tickets/v1/staff/tickets/123/timeline" \
  -H "x-tickets-token: $env:UNIS_TICKET_TOKEN" \
  -H "User-Agent: ItemClaw-TicketSkill/1.0" \
  -H "Content-Type: application/json" \
  -d '{"page": 1, "size": 20}'
```

You can also get the timeline by ticket number:

POST `/v1/staff/tickets/number/{ticketNumber}/timeline`

```bash
curl.exe -s -X POST "https://unisticket.item.com/api/item-tickets/v1/staff/tickets/number/TK-00123/timeline" \
  -H "x-tickets-token: $env:UNIS_TICKET_TOKEN" \
  -H "User-Agent: ItemClaw-TicketSkill/1.0" \
  -H "Content-Type: application/json" \
  -d '{"page": 1, "size": 20}'
```

### Page ticket messages

POST `/v1/staff/tickets/{id}/messages` — paginate through just the messages on a ticket.

```bash
curl.exe -s -X POST "https://unisticket.item.com/api/item-tickets/v1/staff/tickets/123/messages" \
  -H "x-tickets-token: $env:UNIS_TICKET_TOKEN" \
  -H "User-Agent: ItemClaw-TicketSkill/1.0" \
  -H "Content-Type: application/json" \
  -d '{"page": 1, "size": 20}'
```

### Reply to a ticket

POST `/v1/staff/tickets/{id}/reply`

The reply body requires three fields: `displayStatusId`, `message`, and `notificationInfo`.

```bash
curl.exe -s -X POST "https://unisticket.item.com/api/item-tickets/v1/staff/tickets/123/reply" \
  -H "x-tickets-token: $env:UNIS_TICKET_TOKEN" \
  -H "User-Agent: ItemClaw-TicketSkill/1.0" \
  -H "Content-Type: application/json" \
  -d '{
    "displayStatusId": 1,
    "message": {
      "content": "Your reply message here",
      "type": 5,
      "sourceChannel": 4,
      "userType": 2
    },
    "notificationInfo": {}
  }'
```

Field details:

- `displayStatusId` (**required**, int64) — the display status to set after replying. Get available values from `GET /v1/staff/ticket/display-status`.
- `message` (**required**) — a message object:
  - `content` (**required**, string) — the reply text (HTML supported)
  - `type` (**required**, int) — message type: 1=message, 2=system, 3=internal_note, 4=side_conversation, **5=reply**
  - `sourceChannel` (**required**, int) — use `4` (API) for skill-generated replies
  - `userType` (**required**, int) — 1=customer, **2=staff**, 3=system
  - `attachments` (optional, array) — file attachments
- `notificationInfo` (**required**) — notification settings; pass `{}` for defaults, or specify `toCustomerIds`, `ccUsers`, `bccUsers`, etc.

### Update a ticket

PUT `/v1/staff/tickets/{id}` — update ticket fields like assignment, priority, topic, etc.

```bash
curl.exe -s -X PUT "https://unisticket.item.com/api/item-tickets/v1/staff/tickets/123" \
  -H "x-tickets-token: $env:UNIS_TICKET_TOKEN" \
  -H "User-Agent: ItemClaw-TicketSkill/1.0" \
  -H "Content-Type: application/json" \
  -d '{"staffId": 456, "priorityId": 2}'
```

### Create a ticket

POST `/v1/staff/tickets`

Creating a ticket requires several fields. First fetch topics, departments, and display statuses to get valid IDs.

```bash
curl.exe -s -X POST "https://unisticket.item.com/api/item-tickets/v1/staff/tickets" \
  -H "x-tickets-token: $env:UNIS_TICKET_TOKEN" \
  -H "User-Agent: ItemClaw-TicketSkill/1.0" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Ticket subject",
    "topicId": 1,
    "departmentId": 1,
    "customerId": 1,
    "displayStatusId": 1,
    "sourceChannel": 4,
    "message": {
      "content": "Ticket description / first message",
      "type": 1,
      "sourceChannel": 4,
      "userType": 2
    },
    "notificationInfo": {}
  }'
```

Required fields: `title`, `topicId`, `departmentId`, `customerId`, `displayStatusId`, `sourceChannel`, `message`, `notificationInfo`.

Optional fields: `staffId`, `teamId`, `organizationId`, `priorityId`, `slaId`, `dueDate`, `formEntries`, `followerStaffIds`, `tagIds`, `collaborators`.

### Toggle follow on a ticket

POST `/v1/staff/tickets/{ticketId}/follow`

```bash
curl.exe -s -X POST "https://unisticket.item.com/api/item-tickets/v1/staff/tickets/123/follow" \
  -H "x-tickets-token: $env:UNIS_TICKET_TOKEN" \
  -H "User-Agent: ItemClaw-TicketSkill/1.0"
```

## Lookup Endpoints

These are needed to resolve IDs for creating/updating tickets:

- **List topics**: POST `/v1/staff/topics/page` with `{"page": 1, "size": 50}`
- **List departments**: POST `/v1/staff/departments/page` with `{"page": 1, "size": 50}`
- **List display statuses**: GET `/v1/staff/ticket/display-status`
- **List priorities**: GET `/v1/staff/ticket/priorities/list`
- **List staff**: POST `/v1/staff/staff/page` with `{"page": 1, "size": 50}`
- **List teams**: POST `/v1/staff/teams/page` with `{"page": 1, "size": 50}`

All lookup endpoints use the same auth headers.

## System Status Codes

Used in `displayStatusSystemStatus` filter arrays:

- `10` = open
- `20` = closed
- `30` = archived
- `40` = deleted

## Source Channels

- `1` = Phone
- `2` = Email
- `3` = Web
- `4` = API (use this for skill-generated actions)
- `5` = Other
- `6` = Open Form
- `7` = Chat Session
- `8` = AI Assistant
- `9` = Ticket APP

## Message Types

- `1` = message
- `2` = system
- `3` = internal_note
- `4` = side_conversation
- `5` = reply

## Tips

- **"How many tickets do I have?"** — call `/v1/staff/auth/current` to get the staffId, then POST `/v1/staff/tickets/page` with `{"page": 1, "size": 1, "input": {"staffId": <id>}}` and read the `total` field.
- **"Show my open tickets"** — filter with `{"staffId": <id>, "displayStatusSystemStatus": [10]}`.
- **"Show overdue tickets"** — filter with `{"staffId": <id>, "ticketIsOverdue": true}`.
- **Ticket numbers** look like `TK-00123`; use the get-by-number endpoint for those.
- **Before replying or creating**, fetch display statuses via `GET /v1/staff/ticket/display-status` to get valid `displayStatusId` values.
- Responses can be large; use `size` to limit results and summarize for the user.
- Date format is always `MM/dd/yyyy HH:mm:ss` (e.g., `03/09/2026 14:30:00`).
