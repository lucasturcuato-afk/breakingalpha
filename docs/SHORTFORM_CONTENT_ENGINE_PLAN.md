# Signalera — Short-Form Content Engine Plan

## Objective

Build a production-grade short-form content system on top of **Signalera** that turns the platform’s existing market intelligence into daily, reviewable, high-quality vertical videos for:

- TikTok
- Instagram Reels
- YouTube Shorts

This system should help Signalera publish:

- daily market briefs
- breaking-news explainers
- stock-move analysis
- macro / rates clips
- occasional deeper market or sector commentary

The immediate goal is **not** broad product marketing, a full social scheduler, or a giant autonomous media platform.

The immediate goal is to make Signalera a reliable **content production engine** that can generate strong short-form finance videos every day.

---

## Strategic Thesis

This is the right move because it lets Signalera do four things at once:

1. **Create public-facing value before full product launch**  
   The frontend can continue evolving while the intelligence layer already starts producing audience-facing output.

2. **Build audience before formal launch marketing**  
   Instead of waiting for a perfect launch, Signalera starts earning attention now.

3. **Train the product voice in public**  
   The content system becomes a forcing function for sharper story selection, stronger "why it matters," and more differentiated market framing.

4. **Build a future distribution asset**  
   Once the product is more launch-ready, the content engine can naturally become a top-of-funnel system for newsletters, waitlists, app signups, and product usage.

The content should not feel like generic finance commentary. It should feel like it is powered by Signalera’s internal intelligence.

---

## Core Principle

Build this as a **content operating system**, not a generic marketing platform.

That means:

- Signalera’s product intelligence remains the source of truth
- content generation is layered on top of existing story outputs
- the system is optimized for quality, repeatability, and speed
- automation should increase leverage without reducing trust
- the engine should stay modular so tools can be swapped later without rewriting core logic

The system should answer five questions every day:

1. What story should I post?
2. What angle should I use?
3. What exactly should I say?
4. What should the subtitles and on-screen text look like?
5. What should I send into the rendering and editing pipeline?

---

## What Success Looks Like

A successful version of this system means:

- every day, Signalera can surface 2–4 strong short-form content candidates
- each candidate already includes hooks, scripts, captions, render instructions, and subtitle/edit instructions
- the selected output can move cleanly into a video renderer
- the rendered video can move into a subtitle/polish layer
- the final result is a platform-ready 9:16 short-form video
- the human operator only needs to review, approve, and post
- the system reduces content creation from a manual blank-page process into an operator workflow

---

## System Overview

The target workflow is:

**Signalera intelligence pipeline → content selection engine → creative generation engine → render pipeline → subtitle/polish pipeline → human QA → publish**

This should be thought of as a **production pipeline**, not a collection of ad hoc prompts.

---

## Full Recommended Stack

## 1. Core Intelligence Layer

### Signalera
Signalera remains the brain of the entire system.

Responsibilities:
- ingest and rank stories
- synthesize summaries
- generate implication-first "why it matters" analysis
- identify top candidates for content
- score content-worthiness
- package outputs for downstream generation

Signalera should remain the canonical source of truth for what matters.

---

## 2. Creative Generation Layer

### Internal content engine inside Signalera
This is the layer to build now.

Responsibilities:
- normalize stories into canonical content objects
- score stories for content-worthiness
- choose the correct content angle
- generate hooks
- generate scripts of multiple lengths
- generate captions
- generate title/thumbnail lines
- generate on-screen text
- generate storyboard / beat map
- generate render prompts for HeyGen
- generate subtitle/polish prompts for Captions

This layer should live inside the product and should not depend on random external docs or one-off chats.

---

## 3. LLM Layer

### Primary model for content generation: use the existing Signalera LLM stack first
The first version should reuse the same model/provider stack already powering Signalera wherever practical, unless quality clearly requires a separate model for content generation.

Responsibilities:
- hook generation
- script generation
- caption generation
- prompt packaging
- style transformations
- rewrite / regenerate flows

Design principle:
- keep provider choice abstracted behind Signalera’s content-generation functions
- do not hardwire the entire system around a single external model vendor if avoidable

Potential future split:
- one model for core story synthesis
- one model for content packaging / style refinement

---

## 4. Video Rendering Layer

### Primary renderer: HeyGen
Use HeyGen as the primary renderer for the first serious version.

Why:
- best current fit for recurring presenter-style finance videos
- strong for daily brief / breaking-news / stock-move formats
- easy to standardize avatar, voice, pacing, and visual structure
- supports a clear handoff object from Signalera

Primary use cases:
- daily market brief video
- breaking-news explainer video
- stock-move explainer video
- macro / rates explainer video

HeyGen should be treated as the **primary render engine**, not the intelligence layer.

---

## 5. Subtitle / Polish Layer

### Primary finishing tool: Captions
Use Captions as the primary second-pass editor.

Why:
- strong subtitle generation and styling
- more social-native visual polish
- improves pacing and readability
- helps outputs feel less like raw avatar renders
- well-suited for the final pass before TikTok, Reels, and Shorts

Primary use cases:
- auto-subtitles
- subtitle styling
- emphasis treatment on key words / figures / names
- final social polish
- minor pacing improvements

---

## 6. Storage / History Layer

### Supabase
Use Supabase as the system-of-record for content objects and workflow history if it fits the existing app architecture.

Store:
- generated content packs
- render jobs
- approval states
- publish records
- regeneration history
- operator notes

Why:
- keeps the content engine integrated with the existing Signalera product stack
- gives you searchable history and workflow state
- allows internal UI surfaces to stay simple

---

## 7. Internal Operator Surface

### Internal route inside Signalera
Build:
- `/internal/content-studio`

This should be the main operator interface.

Responsibilities:
- review content candidates
- inspect score breakdowns
- inspect scripts and hooks
- inspect HeyGen and Captions prompts
- trigger regenerate actions
- approve or reject outputs
- view history and archive

This should be functional first, beautiful later.

---

## 8. Human Review Layer

A human approval pass remains mandatory in the first serious version.

Responsibilities:
- fact check
- tone check
- ticker/company correctness
- platform fit check
- final go / no-go decision

The first good version should reduce work, not remove judgment.

---

## 9. Publishing Layer

### Phase 1
Manual posting to:
- TikTok
- Instagram Reels
- YouTube Shorts

### Phase 2
Optional scheduler or semi-manual workflow.

### Phase 3
Potential autoposting only after quality is stable.

Autoposting should be a later optimization, not the center of the initial system.

---

## 10. Optional Supporting Tools

These are optional, not required for the first build:

### Descript
Useful later for:
- transcript-first manual cleanup
- voice polish
- alternate edit paths
- packaging clips from longer content

### Arcads
Useful later for:
- paid creative
- AI UGC-style acquisition ads
- product-promo variant testing

Arcads should not be the first core renderer for Signalera’s daily finance content engine.

### Analytics stack
Later consider:
- product analytics inside Signalera
- content performance tracking
- publish logs
- conversion tracking when product marketing begins

But do not let analytics tooling block the initial content engine build.

---

## Recommended Content Formats

Start with **four core formats**.

### 1. Daily Market Brief
Purpose:
- create consistency
- train audience habit
- give the channel a recurring anchor format

Structure:
- hook
- 2–3 key stories
- why each matters
- what to watch next / today

Target duration:
- 25–45 seconds

### 2. Why This Stock Is Moving
Purpose:
- repeatable format
- easy hook construction
- highly legible to short-form audiences

Structure:
- hook
- what happened
- why the market cares
- related names / sector implications
- what to watch next

Target duration:
- 20–40 seconds

### 3. Breaking News Explainer
Purpose:
- capitalize on timely events
- produce quick-turn interpretation when a major development hits

Structure:
- what just happened
- why this matters right now
- second-order implication
- what to watch next

Target duration:
- 20–35 seconds

### 4. Macro / Rates Setup
Purpose:
- create a repeatable market-intelligence format beyond single stocks
- showcase Signalera’s edge on interpretation

Structure:
- hook
- what changed in rates / macro / spreads / commodities / FX
- why the market cares
- what to watch next

Target duration:
- 20–40 seconds

### Optional Later Formats
Do not prioritize these on day one, but they can come later:
- sector roundup
- weekend recap
- market myths / explainers
- founder / VC / markets crossover clips
- product demos and launch teasers

---

## End-to-End Workflow

### Stage 1: Signalera runs normally
Signalera continues its normal workflow:
- ingest articles
- classify stories
- rank relevance
- generate summaries and "why it matters"

This remains the source of truth.

### Stage 2: Content candidate selection
After the normal run, the content engine evaluates the strongest stories.

Each candidate should be scored on dimensions like:
- market importance
- surprise
- investor relevance
- retail interest
- visual potential
- urgency
- confidence
- proprietary edge
- short-form explainability

The system should select:
- 1 daily market brief candidate bundle
- 1–2 stock-move candidates
- 0–1 breaking-news candidates when warranted
- 0–1 macro/rates candidates when warranted

### Stage 3: Content angle selection
For each selected candidate, determine the best format:
- `daily_market_brief`
- `stock_move`
- `breaking_news`
- `macro_rates`
- `none`

Important: the system should be allowed to output **none** if the story is weak, generic, stale, or low-confidence.

### Stage 4: Content pack generation
For each selected content item, generate a structured content pack containing:
- 5–10 hooks
- 1 recommended hook
- short script
- medium script
- long script if useful
- 2+ caption options
- title / thumbnail line
- on-screen text
- storyboard / beat map
- HeyGen render prompt
- Captions subtitle / polish prompt

### Stage 5: Render in HeyGen
Use the chosen script and render package to generate a vertical talking-head video.

Inputs:
- avatar / host selection
- 9:16 template
- voice settings
- title card rules
- lower-third rules
- scene cues
- script timing
- emphasis notes

Output:
- first rendered draft video

### Stage 6: Pass into Captions
Use Captions to add:
- subtitles
- subtitle styling
- pacing polish
- final social edits
- emphasis where useful

Output:
- polished final draft

### Stage 7: Human QA
Operator reviews the final draft for:
- factual accuracy
- ticker/company correctness
- tone / credibility
- subtitle readability
- overall quality

### Stage 8: Publish
After approval, export and post to:
- TikTok
- Instagram Reels
- YouTube Shorts

---

## Recommended Data Model

### CanonicalStory
A normalized story object used across product and content.

```ts
export type CanonicalStory = {
  id: string
  headline: string
  summary: string
  whyItMatters: string
  affectedNames: string[]
  sectors: string[]
  whatToWatch: string
  score: number
  urgency?: number
  confidence?: number
}
```

### StoryScore
A content-worthiness score object.

```ts
export type StoryScore = {
  marketImportance: number
  surprise: number
  investorRelevance: number
  retailInterest: number
  visualPotential: number
  proprietaryEdge: number
  shortFormExplainability: number
  total: number
}
```

### ContentAngle

```ts
export type ContentAngle =
  | 'daily_market_brief'
  | 'stock_move'
  | 'breaking_news'
  | 'macro_rates'
  | 'none'
```

### ContentPack
The main creative output package.

```ts
export type ContentPack = {
  id: string
  angle: 'daily_market_brief' | 'stock_move' | 'breaking_news' | 'macro_rates' | 'none'
  hooks: string[]
  recommendedHook: string
  shortScript: string
  mediumScript: string
  longScript?: string
  captions: string[]
  thumbnailLine: string
  onscreenText: string[]
  storyboard: string[]
  heygenPrompt: string
  captionsPrompt: string
  sourceStoryIds: string[]
  createdAt: string
  status: 'draft' | 'approved' | 'rejected' | 'rendering' | 'rendered' | 'posted'
}
```

### VideoJob
Tracks the downstream rendering process.

```ts
export type VideoJob = {
  id: string
  contentPackId: string
  provider: 'heygen'
  status: 'queued' | 'rendering' | 'rendered' | 'failed'
  outputUrl?: string
  createdAt: string
  updatedAt: string
}
```

### PublishRecord
Tracks where final videos went.

```ts
export type PublishRecord = {
  id: string
  contentPackId: string
  platform: 'tiktok' | 'instagram_reels' | 'youtube_shorts'
  postedAt?: string
  status: 'draft' | 'scheduled' | 'posted'
  externalUrl?: string
}
```

### RegenerationLog
Tracks what got regenerated and why.

```ts
export type RegenerationLog = {
  id: string
  contentPackId: string
  section: 'hooks' | 'script' | 'captions' | 'full'
  reason?: string
  createdAt: string
}
```

---

## Content Selection Logic

This is the most important part of the system.

Do **not** let every Signalera story become content.

A story should only become content if it clears a meaningful threshold on:
- importance
- clarity
- timeliness
- explainability in under ~45 seconds
- differentiated edge
- confidence

### Hard filters
Do not produce content if:
- the story is low-confidence
- the angle is generic
- the story is stale
- the story cannot be explained clearly in short-form
- the insight does not feel stronger than what generic finance accounts would say
- the story is too similar to another clip already produced that day

### Daily quotas
A practical default:
- 1 market brief
- 1 stock move
- 0–1 breaking-news explainer
- 0–1 macro/rates explainer

That is enough volume to stay consistent without turning the feed into sludge.

---

## Script System Design

### Script requirements
Every script should be:
- implication-first
- compressed
- clear
- non-generic
- easy to say aloud
- social-native
- finance-literate without sounding robotic

### Voice guidelines
The voice should feel:
- sharp
- credible
- modern
- slightly elite
- not meme-finance
- not hype-finance
- not CNBC recap language

### Script variants
Generate at least:
- one short script: 20–30 seconds
- one medium script: 30–45 seconds
- optional longer cut: 45–60 seconds for later experiments

### Hook guidelines
Hooks should prioritize:
- surprise
- consequence
- speed of understanding
- specific names / tickers / themes
- high-information opening lines

Avoid:
- weak generic openings
- clickbait without substance
- overhyped language
- filler phrases like "investors are watching" unless highly specific

---

## HeyGen Output Design

The system should generate a dedicated HeyGen-ready package.

That package should include:
- chosen script
- target duration
- title card text
- lower-third suggestions
- pacing notes
- scene change suggestions
- on-screen emphasis words
- avatar / voice notes
- visual mood notes

### Why this matters
If the HeyGen handoff is weak, the rendered output will feel generic.

The render package should be treated as a first-class object, not an afterthought.

### Suggested fields for HeyGen prompt
- content type
- target runtime
- speaking pace
- visual mood
- title line
- on-screen callouts
- where to emphasize company names or figures
- whether b-roll cues exist
- subtitle-safe framing reminders

---

## Captions / Polish Layer Design

After HeyGen renders the video, the second pass should improve the social quality.

### Goals
- subtitles are clean and readable
- subtitle styling feels native to Shorts / Reels / TikTok
- timing matches spoken emphasis
- key words can be emphasized
- visual polish makes the output less obviously AI-generated

### Captions prompt should include
- desired subtitle style
- emphasis rules
- line length rules
- safe-zone awareness
- pacing notes
- emphasis moments
- visual cleanup guidance if needed

---

## Quality Controls

This system should not just generate output. It should reject weak output.

### Recommended quality checks
1. **Banned phrase filter**  
   Reject generic finance filler.

2. **Duplicate topic suppression**  
   Avoid making multiple videos that are basically the same story.

3. **Low-confidence suppression**  
   Skip output when the source story is uncertain or poorly formed.

4. **Fact consistency checks**  
   Ensure the script aligns with source story fields.

5. **Angle validation**  
   If the content angle is weak, output `none`.

6. **Length validation**  
   Ensure short-form scripts remain concise.

7. **Style validation**  
   Reject robotic or bloated wording.

8. **Platform validation**  
   Ensure the asset and subtitle layout fit vertical short-form constraints.

### Practical operator controls
The operator should be able to:
- regenerate hooks only
- regenerate script only
- regenerate captions only
- regenerate full content pack
- approve
- reject
- archive

---

## Product Surface Recommendation

Do not overbuild the UI at first, but do build a serious internal operator surface.

### Recommended internal route
`/internal/content-studio`

### It should show
- top content candidates
- story score breakdown
- selected angle
- generated hooks
- script variants
- captions
- title line
- on-screen text
- storyboard
- HeyGen prompt
- Captions prompt
- status controls
- copy / regenerate actions
- previous outputs / archive
- render history if available

This does not need to be beautiful on day one. It does need to be usable.

---

## Build Phases

## Phase 1 — Foundation
Goal: get a real working system that produces reviewable content packs from live Signalera story output.

Build:
- canonical story types
- story scoring
- angle selection
- content pack generation
- internal content studio route
- copy / regenerate workflow
- content archive / history

Deliverable:
- operator can review and copy a real content pack generated from live Signalera data

## Phase 2 — Render Pipeline
Goal: get from content pack to near-final social video.

Build:
- stronger HeyGen prompt generation
- video job tracking
- render status tracking
- Captions pass workflow
- final asset storage / logging

Deliverable:
- content pack can become a rendered and polished draft through the workflow

## Phase 3 — Production Hardening
Goal: increase reliability and reduce operator effort.

Build:
- quality filters
- duplicate suppression
- stronger style controls
- content approval states
- archive / search / history
- platform-specific output variations

Deliverable:
- system is usable every day without excessive cleanup

## Phase 4 — Distribution Layer
Goal: add light growth and distribution infrastructure once output quality is stable.

Potential additions:
- posting status logs
- CTA variants
- newsletter crossover
- product tie-ins
- eventual autoposting or scheduler integrations

Deliverable:
- system supports both content creation and later-stage product promotion

---

## What Not to Build First

Do not spend initial cycles on:
- full autoposting
- giant marketing dashboards
- too many content formats
- complex multi-agent orchestration
- deep optimization loops before outputs are strong
- overengineered frontend polish
- hard dependencies on every possible downstream tool

The strongest move is to build the **deep core** first:
- selection
- script quality
- render handoff
- subtitle / polish handoff
- review workflow

---

## Repo Recommendation

Create or maintain a source-of-truth plan file at:

`docs/SHORTFORM_CONTENT_ENGINE_PLAN.md`

Keep this file updated as the system evolves.

Recommended initial code areas:
- `/types/`
- `/lib/content/`
- `/app/internal/content-studio/`
- database tables / migrations for content packs, render jobs, publish records, regeneration logs

---

## What To Do Today

### 1. Lock the architecture
Decide that the initial stack is:
- Signalera
- existing LLM layer
- HeyGen
- Captions
- Supabase
- human QA
- manual posting

### 2. Define the objects
Create:
- `CanonicalStory`
- `StoryScore`
- `ContentPack`
- `VideoJob`
- `PublishRecord`
- `RegenerationLog`

### 3. Build the content engine core
Implement:
- story normalization
- scoring
- angle selection
- content pack generation
- archive / history

### 4. Build the internal studio
Get a functional operator route live.

### 5. Run a real story through it
Use a live Signalera story and generate:
- hooks
- short script
- medium script
- title line
- caption options
- HeyGen prompt
- Captions prompt

### 6. Create the first real video
Render a test in HeyGen, run it through Captions, and review the output.

That is enough to create real momentum immediately.

---

## Recommended Internal Positioning

This system should be framed internally as:

**Signalera Short-Form Content Engine**

Not:
- marketing automation platform
- social media manager
- autonomous influencer machine

It is better described as:

**a production-grade content operating system powered by Signalera’s market intelligence**

That framing keeps the product at the center while still letting distribution compound.

---

## Final Recommendation

Proceed with this.

This is a strategically strong move because it:
- creates value before full product launch
- builds audience early
- sharpens Signalera’s voice
- gives the backend immediate leverage
- sets up future product marketing naturally

The right first stack is:

**Signalera → internal content engine → HeyGen → Captions → Human QA → TikTok / Instagram Reels / YouTube Shorts**

And the right first focus is:
- Daily Market Brief
- Why This Stock Is Moving
- Breaking News Explainer
- Macro / Rates Setup

Build the engine to be ambitious at the core, selective in what it publishes, and modular in how it evolves.
