# Summer Thesis Head Start — Campaign Playbook

A summer "get ahead on your thesis/capstone" campaign for ScholarMark, targeting rising
juniors and seniors with big writing projects next year.

The in-product pieces are live in this repo:

| Piece | Where |
| --- | --- |
| Campaign landing page | `/summer` (also `/invite` and `/invite/:code`) — `client/src/pages/SummerCampaign.tsx` |
| Tracked invite links | Query params `campus`, `major`, `channel`, `code`, `ref` are captured and stored with every visit and signup |
| Referral links | Every signup gets a code; share as `/invite/<code>` |
| Signup + visit API | `POST /api/campaign/signup`, `POST /api/campaign/visit` — `server/campaignRoutes.ts` |
| Activation tracking | First document upload or project creation by a signed-up lead marks them activated |
| Metrics dashboard | `/admin/campaign` (requires `ADMIN_USER_IDS`) — clicks, signups, activation rate, referral rate, breakdowns |

Run `npm run db:push` after deploying so the `campaign_visits` and `campaign_signups`
tables exist.

## 1. Audience

Not every student. Students likely to have big writing projects next year:

- **Rising seniors** (strongest leads): thesis, senior seminar, capstone, honors project,
  grad school writing.
- **Rising juniors**: upper-level classes, research methods, major seminars, law/grad
  school prep, honors work.

Best majors to target first: history, English, political science, international
relations, sociology, psychology, philosophy, anthropology, education, environmental
studies, religious studies, gender studies, ethnic studies, public policy,
communications.

Core message:

> Starting a thesis, capstone, or major research paper next year? Use ScholarMark this
> summer to get ahead before classes get busy.

## 2. The offer

**Summer Thesis Head Start.** Not "try my writing tool" — a specific outcome:

> In one week, get your research question, outline, source plan, and first draft
> feedback started before the semester begins.

Position the invite as early access:

> I'm giving early access to students who will be juniors or seniors next year and want
> to get ahead on long papers, thesis projects, capstones, or honors writing.

## 3. Tracked invite links

Never use one generic link everywhere. Build links per campus/major/channel:

```
https://<yourdomain>/summer?campus=ucla&major=history&channel=discord
https://<yourdomain>/summer?campus=usc&major=polisci&channel=instagram
https://<yourdomain>/summer?campus=general&major=english&channel=friend&code=HISTCAPSTONE
```

Referral links use the path form:

```
https://<yourdomain>/invite/maya-3f2a
```

Everything is recorded automatically — school, class year, major, channel, invite code,
signup date, activation, first action, and referral source all land in the
`/admin/campaign` dashboard. No separate spreadsheet needed, though the
`recentSignups` table exports cleanly if you want one.

The key metric is not signups. It is **activation rate**: how many students actually use
the tool (upload a source or create a project) after signing up.

## 4. Outreach channels

Use channels where students already are. Don't lead with cold email.

| Channel | How to use it |
| --- | --- |
| Student orgs | Ask club leaders to share the invite with juniors/seniors |
| Major group chats | History majors, pre-law, psych majors, honors students |
| Discord/GroupMe | Best for student-to-student sharing |
| Instagram/TikTok | Short "thesis panic prevention" content |
| Campus ambassadors | Give students referral codes |
| Writing centers/tutors | Partner carefully as a supplement, not replacement |
| Department newsletters | Best with permission from advisors or student groups |
| Reddit college communities | Only if you provide value, not spam |

Best early growth method: find 10–20 students in writing-heavy majors and ask them to
share with 5 friends each.

## 5. Outreach message templates

**DM version**

> Hey, I'm working on ScholarMark, a writing tool for students starting big papers,
> theses, capstones, or research projects next year.
>
> I'm giving early summer access to rising juniors and seniors who want to get ahead
> before classes start. It helps with research questions, outlines, argument clarity,
> and draft feedback.
>
> Here's the invite link: [link]
>
> Also, if you know anyone doing a senior thesis, honors paper, or capstone next year,
> feel free to send it to them.

**Casual version**

> If you're going to be a junior or senior next year and have big writing classes, a
> thesis, or a capstone coming up, I'm giving summer access to ScholarMark.
>
> It helps you get your topic, outline, sources, and draft feedback started early so
> you're not stressed in the fall.
>
> Invite link: [link]

**Student org leader**

> Hey, I'm reaching out because a lot of juniors and seniors in your org may have
> thesis, capstone, honors, or research-heavy classes next year.
>
> I'm running a summer early-access campaign for ScholarMark, a writing support tool
> that helps students plan, outline, revise, and organize long academic papers.
>
> Would you be open to sharing this invite link with members who might want to get
> ahead this summer?
>
> [link]

**Email version**

Subject ideas:

- Get ahead on your thesis or capstone this summer
- Early access for rising juniors and seniors
- Starting a big paper next year?

> Hi [Name],
>
> I'm inviting rising juniors and seniors to try ScholarMark over the summer before
> thesis, capstone, honors, and research-heavy classes start in the fall.
>
> ScholarMark helps students build research questions, create outlines, organize
> arguments, and improve drafts while keeping the work their own.
>
> You can join here: [invite link]
>
> Best,
> [Your Name]

For commercial email, follow CAN-SPAM: accurate sender info, no deceptive subject
lines, a working opt-out, and your business/contact information in the footer.

## 6. Follow-up sequence

Send manually or via any email tool; the lead list (name, email, signup date) is in
`/admin/campaign`.

**Day 0 — Welcome**

- Subject: Welcome to ScholarMark
- Body: Start here: add your topic, prompt, or rough idea. ScholarMark will help you
  turn it into a research question and outline.
- CTA: Start my paper plan

**Day 2 — Quick win**

- Body: Not sure what to write about yet? Start by turning your rough idea into a
  research question.
- CTA: Create my research question

**Day 5 — Summer benefit**

- Body: The goal is not to finish the whole paper this week. The goal is to start
  before everyone else is stressed in September.
- CTA: Build my outline

**Day 9 — Referral ask**

- Body: Know another rising junior or senior with a thesis, capstone, or long paper
  next year? Send them your invite link.
- CTA: Copy referral link

**Day 14 — Convert active users**

- Body: You've started your writing plan. Keep using ScholarMark weekly to stay ahead
  before the semester starts.
- CTA: Continue my writing plan

## 7. The 8-week summer writing plan

Shown to every signup on the landing page success screen:

1. Pick topic and research question
2. Build source list
3. Create outline
4. Draft intro and thesis statement
5. Draft first section
6. Revise argument and structure
7. Clean up citations and transitions
8. Prepare for fall semester

This makes the invite feel like a program, not just a link.

## 8. Referral rewards (suggested)

| Referrals | Reward |
| --- | --- |
| 1 friend | Extra free credits/features |
| 3 friends | Free month |
| 5 friends | Premium summer access |
| 10 friends | Campus ambassador status |

Copy: "Invite 3 friends who are starting big papers next year and unlock full summer
access."

FTC endorsement guidance: if students are rewarded for promoting ScholarMark, that
material connection must be disclosed clearly in their posts.

## 9. 4-week launch schedule

**Week 1 — Set up.** Landing page, invite links, tracking, welcome email, 3 follow-up
emails, referral codes, academic integrity statement. (The product pieces ship with
this repo; the emails are above.)

**Week 2 — Seed users.** Goal: 25–50 users. Reach out to friends, student org leaders,
honors students, writing-heavy majors, campus group chats, tutors, TAs you know
personally. Ask for feedback, not just signups.

**Week 3 — Campus push.** Goal: 100–300 signups. Content angles:

- "POV: your senior thesis is due next semester and you actually started in June."
- "3 things to do this summer before your capstone starts."
- "How to choose a thesis topic before fall."
- "Don't wait until September to start your 30-page paper."

**Week 4 — Referral push.** Goal: users invite other users. Send the Day-9 referral
message to all active users.

## 10. Weekly metrics

All computed on `/admin/campaign`:

| Metric | Meaning |
| --- | --- |
| Link clicks | Whether the message is interesting |
| Signups | Whether the landing page works |
| Signup rate | signups / link clicks |
| Activation rate | users who used the tool / signups |
| Referral rate | users whose code was used / active users |
| Major/school/channel breakdown | Where demand is strongest |

Track invites sent (outreach volume) manually — it happens off-platform.

## 11. Guardrails

Never market it as: "write your paper for you", "get an A automatically", "beat
plagiarism detectors", "do your thesis with AI".

Always market it as: "plan your paper", "improve your argument", "get feedback",
"organize your ideas", "revise your own writing", "stay ahead over the summer".

The landing page carries the academic integrity statement:

> ScholarMark helps you improve your own writing, planning, structure, and revision.
> It does not replace your work or write assignments for you.

Privacy: the signup form collects only name, email, school, major, year, and paper
type — no sensitive student information. If you later work through schools or touch
education records, review FERPA. COPPA applies to under-13 users and shouldn't be in
play for this audience, but don't target anyone under 13.
