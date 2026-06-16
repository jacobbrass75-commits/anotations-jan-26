# Internal Growth Tool Brief

Last updated: June 16, 2026

This is a brief for a separate internal operator tool. Do not build this into the ScholarMark product app and do not push outreach automation into customer-facing routes.

## Purpose

Help the founder run the Summer Thesis Head Start campaign without losing leads, follow-ups, referrals, or activation status.

The first version should be a lightweight internal workspace, not a polished SaaS feature.

## Version 0: No-Code Stack

- CRM: Google Sheet or Airtable.
- Calendar: Google Calendar or Calendly.
- Email: Gmail/Google Workspace manual sends for cold/warm outreach.
- Opt-in broadcasts: Kit or Mailchimp only for people who explicitly opt in.
- Demos: Loom.
- Calls: Zoom or Google Meet.
- Payments: live ScholarMark Stripe checkout.
- Product metrics: `/admin/campaign`.

## CRM Columns

```text
Name
Email/profile URL
School
Segment
Source count
Deadline
Channel
First contact date
Follow-up date
Reply status
Demo booked
Paid?
Plan
Activated?
Referral asked?
Referral code/source
Notes
Next action
```

## Qualification Score

- +3 thesis/capstone due in fall
- +2 has 8+ sources already
- +2 citation/lit review pain
- +1 honors/research program
- +1 willing to do a setup call this week

Only spend founder call time on leads scoring 5+.

## Version 1: Separate Internal App

Build only after the no-code sheet becomes annoying.

Features:
- Import CSV leads.
- Store segment, channel, school, deadline, notes, and next action.
- Generate tracked campaign URLs like `/summer?campus=ucla&major=history&channel=discord&code=HISTCAPSTONE`.
- Show due follow-ups by day.
- Copy approved DM/email templates with merge fields.
- Record paid status and activation status manually or by reading exported campaign metrics.
- Track manual referral rewards.
- Export CSV.

Non-features:
- No mass scraping.
- No auto-sending cold email.
- No storing secrets.
- No admin access to production data beyond manual export/import.
- No product route changes in ScholarMark.

## Build Location

Use a separate repo or separate Codex thread/worktree. Suggested name:

```text
scholarmark-growth-ops
```

## First Tool Screens

1. Lead Inbox
   - sorted by score and next action date
   - quick filters for segment/channel/school

2. Outreach Queue
   - due today
   - copy button for first touch, day 2, day 5, day 10

3. Setup Calls
   - booked, completed, no-show, paid
   - activation checklist

4. Referral Ledger
   - referrer
   - referred lead
   - paid confirmed
   - reward owed
   - reward paid

5. Weekly Review
   - touches
   - replies
   - demos
   - paid users
   - activated users
   - top channel
   - top objection

## Success Criteria

The internal tool is useful only if it improves the founder loop:

- fewer missed follow-ups
- faster campaign link creation
- clearer channel ROI
- cleaner referral reward tracking
- no risk to the production ScholarMark app
