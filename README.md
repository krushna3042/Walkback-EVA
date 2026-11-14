Title: Walkback: EVA range and route planner

Tagline: Where can I go on Mars and still get back?

Intro: Walkback is a browser app for planning a Mars surface walk (EVA). An astronaut is limited by oxygen, suit power and daylight. Walkback shows every place they can reach and still walk home within the smallest of those limits, then gives route options and step-by-step directions. Built for the NASA Space Apps Challenge 2026.

Important note: This version runs on synthetic sample terrain, not real Mars data, and is not for real mission use. The app labels this on the map.

What it does: a reach zone (every cell where the walk out plus the walk back fits the budget); three routes to a target (Fastest, Safest, Science), each rated GO, TIGHT or NO-GO; slope-aware walking time (uphill and downhill cost differently); a destination check with a nearest reachable point and a fix suggestion; astronaut directions with heading, distance, slope, time and budget left, with Outbound and Return tabs; a live EVA mode that re-plans from the astronaut’s position and switches to Return at the turnaround point; presets and limit sliders; a data honesty panel; dark and light themes.

How it works: a 170 × 120 elevation grid of 30 m cells (5.1 × 3.6 km). Slope is computed per step, walking time comes from a slope-dependent pace, and Dijkstra runs once for the walk out and once on reversed edges for the walk home. Usable time = the smallest of oxygen, power and daylight, times (1 − reserve), minus time at target. A cell is in reach if out time plus back time is within usable time.

Data and assumptions: Derived means slope and walking time from the grid. Measured means none in this build. Assumed means pace, slope limits, soft-ground slowdown and reserve.

Run locally: needs Node.js 18 or newer. Run npm install, then npm run dev. Build with npm run build.

Tech stack: React, TypeScript, Vite, Tailwind CSS. The planner is plain TypeScript with no backend.

Limitations: sample terrain only, assumed limits, and times not yet validated against real traverses.

Roadmap: real HiRISE terrain of Jezero, THEMIS thermal inertia and the geologic map; validation against the Perseverance traverse; communication dead zones; MEDA weather timing. Say clearly that these are planned.

Team: Team Hugo 

Acknowledgements: NASA Space Apps Challenge 2026. License: MIT.

AI assistance: This project was built with AI assistance. Claude (Anthropic) helped plan the idea, draft the slides and write build prompts. Gemini in Google AI Studio generated and edited the app code. The team directed the work, reviewed and tested the result. The cover illustration in the project slides was drawn with AI and is labelled. No AI-generated video or audio was used.
