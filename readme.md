# SIM Calendar Downloader

Extracts class schedule and convert them into calendar (.ics) file.

> [!CAUTION]
>
> **DO NOT** send **data/store.b64** file
>
> It contains credentials that are able to bypass **2FA / MFA (Two / Multi Factor Authentication)**

> [!IMPORTANT]
> Timetable is subjected to changes. Make sure to check and update them accordingly.
>
> **I WILL NOT** be responsible to any attendance issue caused by this program.

## Questions? Bugs? Issues?

- Submit them via issues. [link](https://github.com/du-cc/sim-calendar/issues/new/choose)

## Installation

### Requires [NodeJS](https://nodejs.org/en/download)

## Quick Start
Linux/Windows/MacOS (with [git](https://git-scm.com/install/))
```bash
git clone https://github.com/du-cc/sim-calendar.git && cd sim-calendar && npm install https://github.com/du-cc/sim.git && npm start
```
Without git (Use **cmd** for windows, only tested in Linux)
```bash
curl -L -o sim-calendar.tar.gz https://github.com/du-cc/sim-calendar/archive/refs/heads/main.tar.gz && tar -xzf sim-calendar.tar.gz && cd sim-calendar-main && npm i https://github.com/du-cc/sim.git && npm start
```
## Manual
1. Download this repo
2. Install library via npm
```bash
npm install https://github.com/du-cc/sim.git
```
3. npm start

## Tutorials
### [How to extract cookies](https://www.youtube.com/watch?v=hIdTmgWu2f8)

## Development

### Libraries

- [sim](https://github.com/du-cc/sim) - Outsystems API wrapper for MySIMApp

### AI

- Code: [main.js](./main.js) - API endpoint design and implementation
