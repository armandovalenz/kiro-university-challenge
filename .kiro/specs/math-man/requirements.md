# Requirements Document

## Introduction

Math Man is an educational, browser-based maze arcade game inspired by Pac-Man. The player guides a character ("Math Man") through a maze, collecting pellets while avoiding Einstein ghosts. The educational twist: when an Einstein ghost catches Math Man, instead of an instant loss, the player is presented with a math question matched to a chosen difficulty level (5th, 6th, or 7th grade). Answering correctly saves Math Man; answering incorrectly costs a life. Fruits appear periodically in the maze; collecting one grants an extra life and displays a short math or science lesson.

The Einstein ghosts come in multiple colors, echoing the classic Pac-Man ghost quartet, so the maze is populated by a colorful group of Einstein pursuers. The game opens with a splash screen showing the Math Man logo before the start menu.

The game targets modern browsers (Chrome, Firefox, Safari, Edge), requires no login or authentication, and stores all records (high scores, progress) in the browser's local memory (localStorage). The game must be playable with keyboard controls, start Math Man with 6 lives, and allow lives to grow up to a maximum of 10.

## Glossary

- **Math Man**: The player-controlled character navigating the maze.
- **Pellet**: A collectible dot in the maze that awards points. Clearing all pellets completes a level.
- **Einstein Ghost**: A ghost that, on catching Math Man, triggers a math quiz instead of an immediate life loss. Einstein ghosts appear in multiple colors (e.g., red, pink, cyan, orange), similar to the classic Pac-Man ghosts.
- **Fruit**: A bonus collectible that grants an extra life and shows a short educational lesson.
- **Life**: A unit of the player's remaining chances. The game starts with 6 and can grow up to a maximum of 10.
- **Difficulty Level / Grade**: The selected grade band (5th, 6th, or 7th) that determines the difficulty of quiz questions and may affect gameplay pacing.
- **Splash Screen**: An intro screen displaying the Math Man logo shown before the start menu.
- **Local memory / records**: Data persisted in the browser via `localStorage` (no server, no login).

## Requirements

### Requirement 1: Core Maze Gameplay

**User Story:** As a player, I want to move Math Man through a maze and collect pellets, so that I can score points and progress through the game.

#### Acceptance Criteria

1. WHEN the game starts THEN the system SHALL render a maze containing Math Man, ghosts, and pellets.
2. WHEN the player presses an arrow key or WASD key THEN the system SHALL move Math Man in the corresponding direction if the path is not blocked by a wall.
3. WHILE Math Man is moving THE system SHALL prevent Math Man from passing through walls.
4. WHEN Math Man moves over a pellet THEN the system SHALL remove the pellet and increase the score.
5. WHEN all pellets in the maze are collected THEN the system SHALL advance the player to the next level or display a win state.
6. WHEN the game is running THE system SHALL display the current score and remaining lives on screen.

### Requirement 2: Lives System

**User Story:** As a player, I want a limited number of lives, so that the game presents a fair challenge.

#### Acceptance Criteria

1. WHEN a new game begins THEN the system SHALL set the player's lives to 6.
2. WHEN Math Man loses a life THEN the system SHALL decrement the life count by 1 and update the display.
3. IF the life count reaches 0 THEN the system SHALL trigger a game-over state.
4. WHEN the player gains a life THEN the system SHALL increment the life count and update the display.
5. THE system SHALL cap the life count at a maximum of 10.
6. IF the player gains a life WHILE at the maximum of 10 lives THEN the system SHALL keep the count at 10 and SHALL NOT exceed it.

### Requirement 3: Einstein Ghosts and Collisions

**User Story:** As a player, I want colorful Einstein ghosts that chase Math Man, so that the game is challenging and visually engaging.

#### Acceptance Criteria

1. WHILE the game is running THE system SHALL move the Einstein ghosts through the maze using a pursuit/patrol behavior.
2. THE system SHALL render multiple Einstein ghosts in distinct colors (e.g., red, pink, cyan, orange), echoing the classic Pac-Man ghost quartet.
3. WHEN any Einstein Ghost collides with Math Man THEN the system SHALL pause gameplay and present a grade-appropriate math or science question (see Requirement 4).
4. WHEN Math Man loses a life AND lives remain THEN the system SHALL reset Math Man and the ghosts to their starting positions.
5. THE system SHALL give each Einstein ghost a recognizable Einstein appearance (e.g., wild-hair motif) while keeping the colors distinct.
6. THE system MAY vary ghost speed or aggressiveness based on the selected difficulty level (see Requirement 10).

### Requirement 4: Einstein Challenge (Educational Core)

**User Story:** As a student player, I want to answer a grade-appropriate math or science question when the Einstein ghost catches me, so that I can save my life and practice what I'm learning.

#### Acceptance Criteria

1. WHEN an Einstein Ghost catches Math Man THEN the system SHALL pause the game and display a question matched to the selected grade level (see Requirement 10).
2. THE system SHALL load questions from the bundled question bank at `public/assets/questions/math_man_question_bank_120.json`, which contains grade-tagged (5/6/7) math and science questions across many topics and difficulty tiers (easy/medium/hard).
3. THE system SHALL select a question whose `grade` matches the selected level; it MAY further filter by `subject` (math/science) and/or `difficulty`.
4. WHEN the question is displayed THEN the system SHALL present its multiple-choice options for the player to select (numeric entry MAY be used where appropriate).
5. IF the player selects the correct answer THEN the system SHALL NOT deduct a life, SHALL show positive feedback, and SHALL resume gameplay.
6. IF the player selects an incorrect answer THEN the system SHALL deduct one life, SHALL show the correct answer with the question's `explanation`, and SHALL resume gameplay (or trigger game-over if lives reach 0).
7. THE system SHALL prevent ghost/Math Man movement while the question modal is open.
8. THE system SHALL avoid repeating the same question (by `id`) twice in a row within a single game session, and SHOULD avoid recently-used questions where possible.
9. IF the question bank fails to load or is malformed THEN the system SHALL fall back to a small built-in question set so the quiz still functions.

### Requirement 5: Fruits, Extra Lives, and Micro-Lessons

**User Story:** As a student player, I want to collect fruits that give me an extra life and a quick lesson, so that I am rewarded and I learn something.

#### Acceptance Criteria

1. WHILE a level is in progress THE system SHALL spawn a fruit in the maze periodically or under defined conditions.
2. WHEN Math Man collects a fruit THEN the system SHALL grant one extra life (subject to the life cap in Requirement 2.5).
3. WHEN Math Man collects a fruit THEN the system SHALL display a short math or science lesson (a "fun fact" or micro-lesson).
4. WHILE the lesson is displayed THE system SHALL allow the player to dismiss it and continue playing.
5. THE system SHALL vary the lessons so repeated fruit collection shows different content when possible.

### Requirement 6: Local Records (No Login)

**User Story:** As a player, I want my high scores and stats saved on my device, so that I can track progress without creating an account.

#### Acceptance Criteria

1. THE system SHALL NOT require login or authentication to play.
2. WHEN a game ends THEN the system SHALL persist the final score to `localStorage`.
3. WHEN the game loads THEN the system SHALL read existing records from `localStorage` and display the high score.
4. IF a new score exceeds the stored high score THEN the system SHALL update the stored high score.
5. IF `localStorage` is unavailable THEN the system SHALL continue to function using in-memory records for the session without crashing.
6. THE system SHALL optionally track quiz stats (questions answered, correct rate) in local memory.

### Requirement 7: Game States, Splash Screen, and Controls

**User Story:** As a player, I want a branded splash screen plus clear start, pause, and game-over screens, so that the game feels polished and I can control my play session.

#### Acceptance Criteria

1. WHEN the page loads THEN the system SHALL first display a splash screen showing the Math Man logo.
2. THE splash screen SHALL transition to the start menu automatically after a short delay OR when the player presses a key / clicks.
3. WHEN the start menu is shown THEN the system SHALL display a play button, a difficulty/grade selector (see Requirement 10), and the current high score.
4. WHEN the player starts a game THEN the system SHALL transition to the playing state and begin gameplay.
5. WHEN the player presses the pause key THEN the system SHALL toggle a paused state that halts movement.
6. WHEN the game-over state is triggered THEN the system SHALL display the final score, high score, and an option to restart or return to the start menu.
7. WHEN the player chooses to restart THEN the system SHALL reset lives, score, and the maze to initial values while preserving the selected difficulty.

### Requirement 8: Browser Compatibility and Tech Constraints

**User Story:** As a player, I want the game to run in my browser without installs, so that it is easy to access.

#### Acceptance Criteria

1. THE system SHALL run in current versions of Chrome, Firefox, Safari, and Edge.
2. THE system SHALL be built with standard web technologies (HTML5, CSS, JavaScript) and SHALL NOT require a backend server to play.
3. THE system SHALL render gameplay using a WebGL-accelerated renderer with an automatic HTML5 Canvas fallback (via the Phaser 3 framework).
4. THE system SHALL be operable via keyboard, and SHOULD degrade gracefully on unsupported input.
5. THE system SHALL not depend on any feature that is unavailable in the listed evergreen browsers.

### Requirement 9: Accessibility and Feedback

**User Story:** As a player, I want clear visual and textual feedback, so that the game is understandable and inclusive.

#### Acceptance Criteria

1. WHEN a life is gained or lost THEN the system SHALL provide visible feedback.
2. THE system SHALL use sufficient color contrast for text (score, lives, questions, lessons).
3. THE quiz and lesson modals SHALL present text that is readable and dismissible via keyboard.
4. THE system SHALL allow all audio to be muted (see Requirement 12).

### Requirement 10: Difficulty Levels (Grade Selection)

**User Story:** As a student player, I want to choose my grade level, so that the math questions match what I am learning.

#### Acceptance Criteria

1. WHEN the start menu is shown THEN the system SHALL let the player select a difficulty level of 5th, 6th, or 7th grade.
2. THE system SHALL default to a defined grade (e.g., 5th) if the player does not choose one.
3. WHEN a difficulty level is selected THEN the system SHALL use question categories matched to that grade (see Requirement 4.2).
4. THE system MAY adjust gameplay parameters (ghost speed, fruit frequency) per difficulty level to increase challenge with grade.
5. THE system SHALL persist the last selected difficulty in `localStorage` and preselect it on the next visit.
6. THE system SHALL maintain a single global high score across all difficulty levels.

### Requirement 11: Branding and Visual Assets

**User Story:** As a player, I want a recognizable Math Man logo and consistent art, so that the game feels complete and memorable.

#### Acceptance Criteria

1. THE system SHALL display the Math Man logo (`public/assets/images/02_logo.png`) on the splash screen.
2. THE system SHALL show the Math Man branding (logo, and optionally the hero image `09_hero_einstein_enemies.png`) on the start menu.
3. THE logo and other image assets SHALL be delivered as web-friendly files (the provided PNGs, optionally optimized/exported to SVG) and SHALL scale without breaking layout.
4. THE branding SHALL visually reflect the math/education theme (a Pac-Man-style character combined with a math motif), consistent with the provided art.
5. THE system SHALL use the app icon (`03_app_icon.png`) as the source for the browser favicon and any PWA icon.
6. THE provided image assets and their intended uses SHALL be documented in `public/assets/images/ASSETS.md`.

### Requirement 13: Sprites and In-Game Art

**User Story:** As a player, I want the characters and items drawn with real art rather than plain shapes, so that the game looks polished.

#### Acceptance Criteria

1. THE system SHALL render Math Man using frames from the mascot sprite sheet (`04_mascot_sprite_sheet.png`) for movement/pose animation.
2. THE system SHALL render pellets, fruit, and life icons using the collectibles/math icon art (`05_collectibles_and_math_icons.png`).
3. THE system SHALL style the HUD, buttons, and quiz/lesson panels using the UI kit art (`06_ui_kit.png`) where practical.
4. THE Einstein ghosts SHALL be rendered with distinct colors and an Einstein motif, consistent with the provided concept art (`08_poster_einstein_enemies.png`, `09_hero_einstein_enemies.png`).
5. IF an image asset fails to load THEN the system SHALL fall back to a simple drawn shape or text so gameplay continues (see Requirement 9 and error handling).
6. THE system SHOULD use optimized/resized versions of the large source PNGs to keep load times reasonable.

### Requirement 12: Music and Sound Effects

**User Story:** As a player, I want arcade-style background music and sound effects for game events, so that the game feels lively and responsive like classic Pac-Man.

#### Acceptance Criteria

1. THE system SHALL play background music appropriate to the current state (splash/menu, gameplay, game-over).
2. THE system SHALL play a distinct sound effect for each significant game event, including at minimum:
   - game start / intro jingle,
   - pellet eaten,
   - fruit spawned,
   - fruit collected / bonus,
   - extra life gained,
   - Einstein ghost catches Math Man,
   - quiz answered correctly,
   - quiz answered incorrectly,
   - life lost,
   - level cleared,
   - game over,
   - new high score,
   - menu navigation / selection,
   - pause / unpause.
3. THE system SHALL support audio assets in MP3 format (WAV MAY be supported as an optional alternative for short effects).
4. WHEN the player toggles mute THEN the system SHALL silence all music and sound effects and SHALL persist the mute state in `localStorage`.
5. WHEN audio is muted THEN gameplay SHALL continue unaffected.
6. IF an audio asset fails to load or the browser blocks autoplay THEN the system SHALL continue running without errors and SHALL start/resume audio after the first user interaction.
7. THE system SHALL manage audio via the Web Audio API (directly or through the chosen engine/library) for low-latency playback of pre-decoded sound effects.
8. THE gameplay background music MAY loop and MAY change tempo/intensity with difficulty or level (Pac-Man-style siren behavior) as an enhancement.
