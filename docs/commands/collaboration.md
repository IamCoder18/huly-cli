---
title: Collaboration commands
description: huly-cli commands for comments, channels, direct messages, threads, and activity feeds in self-hosted Huly.
---

# Commands — Collaboration

Comments, channels, direct messages, threads, and activity messages.

## Table of contents

- [comment](#comment)
- [channel](#channel)
- [dm](#dm)
- [thread](#thread)
- [activity](#activity)

---

## comment

```bash
huly comment list --issue <ref>     # issue can be TSK-1 or full _id
huly comment add --issue TSK-1 --body "Looking into this"
huly comment add --issue TSK-1 --body-file ./comment.md
huly comment update <commentRef> --body "Updated text"
huly comment delete <ref...> [--yes]
```

**Best practices & side effects:** issue comments are stored as
`ChatMessage`s in the issue's `comments` collection. Sending a
comment auto-adds the author (and any `@mentioned` users) as
collaborators on the issue, and emits an inbox notification per
collaborator. Delete cascades — any `InboxNotification` attached to
the deleted comment is removed.

---

## channel

```bash
huly channel list [--archived]
huly channel get <ref>
huly channel create --name "engineering" [--description] [--topic "..."] [--private] [--auto-join] [--members <email...>]
huly channel update <ref> [--name] [--topic "..."] [--description] [--private true|false] [--auto-join true|false]
huly channel delete <ref...> [--yes]
huly channel archive <ref> [--value false]   # value=false to unarchive
huly channel unarchive <ref>
huly channel members <ref>
huly channel join <ref>                       # join self
huly channel join <ref> --member alice@...   # join specific user
huly channel leave <ref>
huly channel add-member <ref> --members <email...>      # one or more members
huly channel remove-member <ref> --members <email...>

huly channel message list <channelRef>
huly channel message send <channelRef> --body "hello" [--body-file <path>]
huly channel message update <channelRef> <messageRef> --body "edited" [--body-file <path>]
huly channel message delete <channelRef> <messageRef...> [--yes]
```

> Unlike `huly dm`, channel commands don't expose flat-form aliases
> (`huly channel message create` and `huly channel message get` are
> intentionally not provided). Use `huly channel message send` /
> `huly channel message list` respectively. To fetch a specific
> message by `_id`:
>
> ```bash
> huly channel message list engineering --json \
>   | jq '.[] | select(._id == "chunter:class:ChatMessage:<id>")'
> ```

**Best practices & side effects:**

- Sending a message auto-adds the sender as a channel member
  (`$push: members`).
- The sender and every `@`-mentioned person in the message body are
  auto-added as `Collaborator`s on the channel, and each gets an
  inbox notification (subject to their notification provider settings).
- `#general` and `#random` are auto-created when a workspace is
  created. `archive` on these requires `Spaces Admin` or
  `Workspace Owner`.
- `--private true` keeps the channel listed in the sidebar; users
  must request access. Use a DM (not a channel) for hidden
  conversations.
- Channel `auto-join` only affects **future** workspace members,
  never retroactively adds existing ones.

See [Platform behavior — Chat](../reference/platform-behavior.md#chat-channels-dms-threads-comments).

---

## dm

Direct messages.

```bash
huly dm list                                          # list DM spaces
huly dm create --person alice@example.com            # create 1:1 DM
huly dm create --members a@... --members b@...        # group DM
huly dm message list <dmRef>
huly dm message send <dmRef> --body "hi"
huly dm message send <dmRef> --person alice@... --body "hi"   # auto-creates DM
# aliases:
huly dm messages <dmRef>
huly dm send <dmRef> --body "hi"
```

**Best practices & side effects:** sending a DM message parses
`@mentions` from the markup and creates per-recipient inbox
notifications; the mentioned person is auto-added as a
`Collaborator` on the underlying DM space. Use a DM (or group DM)
rather than a private channel if you want a conversation that isn't
listed in the channel sidebar. "Close conversation" hides from the
sidebar but preserves message history.

---

## thread

Replies to chat messages (channel messages or DM messages).

```bash
huly thread list <targetRef>      # target = channel + message _id, or just message _id
huly thread add <targetRef> --body "reply" [--body-file <path>]
huly thread update <replyRef> --body "edited" [--body-file <path>]
huly thread delete <replyRef...> [--yes]
```

**Best practices & side effects:** thread replies attach to the
parent `ActivityMessage` and auto-push the author into
`repliedPersons[]` (unless already present); the parent message's
`lastReply` is updated to the reply's `modifiedOn`. The author and
`@`-mentioned persons in the reply body receive inbox notifications.
Replying to a Telegram notification appears here as a thread reply.

---

## activity

Activity messages (`ActivityMessage`), reactions, replies, saved
messages, and `@mention` lookups.

```bash
huly activity list [--target <ref>] [--target-class <id>] [--pinned] [--limit N]
huly activity get <ref>
huly activity pin <ref> [--unpin]
huly activity react --target <ref> --emoji 👍 [--add|--remove|--list]
huly activity reply list <targetRef>
huly activity reply add <targetRef> --body "..."
huly activity reply update <replyRef> --body "..."
huly activity reply delete <replyRef...> [--yes]
huly activity saved list
huly activity saved save --target <ref>
huly activity saved unsave --target <ref>
huly activity mentions
```

For the difference between **activity comments** and **inline
comments**, see
[Platform behavior — Cards & knowledge management](../reference/platform-behavior.md#cards-knowledge-management-deep).
