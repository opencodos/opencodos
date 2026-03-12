# Confirmation Message Templates

## Language Detection

Determine language from CRM contact record or original message context.

**Default:** Match the language of original conversation

## Reconnect Templates (Propose 2 Slots)

Use these when reaching out after a while to propose meeting times.

### Russian — Reconnect

**Telegram/Slack:**
```
Привет! Давно не общались — как насчёт созвона {day1} в {time1} или {day2} в {time2}?
```

**Short version:**
```
Привет! Как насчёт созвона {day1} {time1} или {day2} {time2}?
```

**Gmail:**
```
Subject: Созвон?

Привет!

Давно не общались — давай созвонимся на этой неделе?

Могу {day1} в {time1} или {day2} в {time2} (по {tz}).

Дай знать, что удобнее!

{signoff}
```

### English — Reconnect

**Telegram/Slack:**
```
Hey! Been a while — how about catching up {day1} at {time1} or {day2} at {time2}?
```

**Short version:**
```
Hey, reconnecting — how about {day1} {time1} or {day2} {time2}?
```

**Gmail:**
```
Subject: Quick sync?

Hey {name}!

Been a while — let's catch up this week?

I'm free {day1} at {time1} or {day2} at {time2} ({tz}).

Let me know what works!

Best,
{signoff}
```

### Variables for Reconnect

- `{day1}`, `{day2}` — e.g., "Thursday", "в четверг"
- `{time1}`, `{time2}` — in THEIR timezone for convenience
- `{tz}` — their timezone label (e.g., "your time", "CET", "Lisbon")
- `{name}` — contact's first name (for email)

---

## Confirmation Templates (After They Accept)

## Templates by Language

### Russian

**Standard confirmation:**
```
Привет! Отправил инвайт на {time}. До связи!
```

**With day:**
```
Привет! Отправил инвайт на {day} в {time}. До связи!
```

**Variables:**
- `{time}` — e.g., "17:30" or "5:30pm"
- `{day}` — e.g., "завтра", "среду", "18 января"

### English

**Standard confirmation:**
```
Sent invite for {time}. See you then!
```

**With day:**
```
Sent invite for {day} at {time}. See you then!
```

**Variables:**
- `{time}` — e.g., "5:30pm BKK" or "10:30am your time"
- `{day}` — e.g., "tomorrow", "Wednesday", "Jan 18"

## Channel-Specific Formatting

### Telegram

Short, casual. No subject line needed.

```
Привет! Отправил инвайт на завтра 17:30. До связи!
```

### Slack

Similar to Telegram, can be slightly more formal for work contacts.

```
Sent you a calendar invite for tomorrow at 5:30pm BKK. See you then!
```

### Gmail

Include subject line. Slightly more formal body.

**Subject:** Meeting Confirmed - {day} at {time}

**Body:**
```
Hi {name},

I've sent you a calendar invite for our call on {day} at {time}.

The invite includes a Google Meet link.

See you then!

Best,
{signoff}
```

**Russian email:**

**Subject:** Звонок подтверждён - {day} в {time}

**Body:**
```
Привет!

Отправил инвайт на {day} в {time}. Ссылка на Google Meet в приглашении.

До связи!

{signoff}
```

## Time Formatting

**For their timezone:**
```
{time} your time ({time_user} BKK)
```

**Example:**
```
10:30am your time (5:30pm BKK)
```

## Day Formatting

| Context | Russian | English |
|---------|---------|---------|
| Today | сегодня | today |
| Tomorrow | завтра | tomorrow |
| Day after | послезавтра | day after tomorrow |
| This week | в среду | on Wednesday |
| Next week | в следующий понедельник | next Monday |
| Specific | 18 января | Jan 18 |

## Examples

### Telegram to Russian contact
```
Привет! Отправил инвайт на завтра в 17:30. До связи!
```

### Slack to Max (English)
```
Sent invite for tomorrow at 5:30pm BKK (10:30am your time). See you then!
```

### Gmail to Contact (English)
```
Subject: Meeting Confirmed - Wednesday at 5:30pm BKK

Hi {name},

I've sent you a calendar invite for our call on Wednesday at 5:30pm BKK (10:30am their time).

The invite includes a Google Meet link.

See you then!

Best,
{signoff}
```
