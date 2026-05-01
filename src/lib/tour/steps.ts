import type { DriveStep } from 'driver.js';

export const TOUR_STEPS: DriveStep[] = [
  {
    // Step 1: Welcome (no element, popover only)
    popover: {
      title: 'Welcome to Signalera',
      description: '60 seconds. We\u2019ll walk through what each surface does and how to get the most out of it. You can exit anytime \u2014 the \u201c?\u201d button in the nav reopens this tour whenever you need it.',
      side: 'over',
      align: 'center',
    },
  },
  {
    element: '[data-tour="brief-card"]',
    popover: {
      title: 'Morning Brief & Evening Wrap',
      description: 'Two daily briefs synthesized from ~200 sources across financial media. Morning brief drops at 6 AM PT covering overnight + pre-market. Evening wrap drops at 5 PM PT covering the trading day and after-hours. Each brief surfaces the top stories clustered by theme, with our reasoning on why each cluster matters.',
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="memo-cta"]',
    popover: {
      title: 'Memo Generation',
      description: 'Generate an institutional-grade investment memo on any ticker or thesis. Each memo includes: a thesis statement, multi-step reasoning, a grade (A\u2013F) based on logical rigor and evidence quality, and a confidence score calibrated against historical accuracy of similar theses. Memos are graded retrospectively, so the system learns which thesis structures actually predict outcomes.',
      side: 'left',
    },
  },
  {
    element: '[data-tour="intelligence-chat"]',
    popover: {
      title: 'Intelligence Chat',
      description: 'Ask questions grounded in our full article corpus \u2014 not generic LLM knowledge. The chat uses RAG over our embedded news index, so answers cite specific articles ingested in the last 7 days. The system also evolves your prompt template over time based on which responses you find useful, so it gets sharper with use.',
      side: 'top',
    },
  },
  {
    element: '[data-tour="contrarian-section"]',
    popover: {
      title: 'Contrarian Signals',
      description: 'For every thesis we generate, an adversarial pass tries to break it. The system actively searches for disconfirming evidence, surfaces overlooked bear cases, and flags when consensus sentiment is suspiciously one-sided. If you only read one section, read this one \u2014 it\u2019s where alpha hides.',
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="story-card"]',
    popover: {
      title: 'Article Quality & Source Credibility',
      description: 'Every article gets two scores: quality (signal density, originality, analytical depth) and source credibility (historical accuracy of the publisher on similar topics). Stories surface based on a weighted blend, so a sharp piece from a smaller outlet can outrank a thin take from a major one.',
      side: 'right',
    },
  },
  {
    element: '[data-tour="profile-link"]',
    popover: {
      title: 'Personalization',
      description: 'Your onboarding answers \u2014 sectors, risk tolerance, time horizon, current positions \u2014 shape every brief and memo you see. Update them anytime in your profile. The more specific you are, the sharper the personalization. Briefs reweight cluster importance based on your stated focus areas.',
      side: 'bottom',
    },
  },
  {
    // Step 8: Outro (no element, popover only)
    popover: {
      title: 'You\u2019re set.',
      description: 'The \u201c?\u201d button in the top nav reopens this tour anytime. Rate limits: 10 memos/day, 15 chat messages/day. If you hit a wall or find a bug, ping us in the TIS Slack #signalera-beta channel.',
      side: 'over',
      align: 'center',
    },
  },
];

export const TOUR_VERSION = 'v1';
