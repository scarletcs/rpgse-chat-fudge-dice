// ==UserScript==
// @name        RPG.SE Chat Fudge Dice
// @namespace   https://github.com/spacemonaut/
// @description Convert RPG.SE chat d6 to Fudge dice (dF) on Stack Exchange Chat
// @grant       none
// @include     https://chat.stackexchange.com/rooms/*
// @include     https://chat.stackexchange.com/transcript/*
// @version     2.0.1
// @run-at      document-idle
// @downloadURL https://github.com/spacemonaut/rpgse-chat-fudge-dice/raw/main/src/index.user.js
// ==/UserScript==


/**
 * Independent debounce function by you-dont-need
 * 
 * Creates a debounce container for a function. When a sequence of calls to the function ends, the argument function is triggered.
 * 
 * @see https://github.com/you-dont-need/You-Dont-Need-Lodash-Underscore#_debounce
 * 
 * @param {Function} func The function to debounce
 * @param {number} wait The debounce window in milliseconds
 * @param {boolean} [immediate=false] Override to trigger at the beginning of the sequence instead of the end.
 * @returns A debounced version of a function.
 */
function debounce(func, wait, immediate) {
  let timeout;
  return function() {
    let context = this, args = arguments;
    clearTimeout(timeout);
    timeout = setTimeout(function() {
      timeout = null;
      if (!immediate) func.apply(context, args);
    }, wait);
    if (immediate && !timeout) func.apply(context, args);
  };
}

/**
 * @enum {number} Fudge score value
 * @readonly
 */
 const FudgeScore = Object.freeze({
  Minus: -1,
  Zero: 0,
  Plus: 1,
});

/**
 * Utilities for fudge dice logic.
 * @abstract
 */
class FudgeUtil {
  /**
   * Convert a d6 score to a Fudge score
   * 
   * @public
   * @param {number} num The d6 score
   * @returns {FudgeScore} The fudge score
   */
  static d6toFudge(num) {
    if (num >= 5) {
      return FudgeScore.Plus;
    } else if (num <= 2) {
      return FudgeScore.Minus;
    } else {
      return FudgeScore.Zero;
    }
  }

  /**
   * Convert a fudge score to its display equivalent.
   * 
   * @public
   * @param {FudgeScore} score The fudge score to display
   * @returns {string} A string representing the score
   */
  static displayScore(score) {
    switch (score) {
      case FudgeScore.Minus:
        return '&minus;';
      case FudgeScore.Plus:
        return '&plus;';
      default:
        return '';
    }
  }
}

/**
 * Shared names for HTML/CSS classes, attributes, and variable names.
 */
const HtmlName = Object.freeze({
  /** @readonly */
  CLS_FUDGE_ROOT: 'fudge-running',
  /** @readonly */
  CLS_FUDGE_ON: 'fudge--on',
  /** @readonly */
  CLS_FUDGE_COLORS_ON: 'fudge-colors--on',
  /** @readonly */
  CLS_FUDGE_DIE: 'fudge-die',
  /** @readonly */
  CLS_FUDGE_DIE_FACE: 'fudge-die-face',
  /** @readonly */
  CLS_FUDGE_DIE_FACE_SYMBOL: 'fudge-die-face-symbol',

  /** @readonly */
  DATA_D6_SCORE: 'data-d6-score',
  /** @readonly */
  DATA_FUDGE_SCORE: 'data-fudge-score',
  
  /** @readonly */
  VAR_FUDGE_DICE_MINUS_COLOR: '--fudge-dice-minus-color',
  /** @readonly */
  VAR_FUDGE_DICE_PLUS_COLOR: '--fudge-dice-plus-color',
});

/**
 * Utilities for interacting with a Chat.SE page.
 * @abstract
 */
class ChatUtil {
  /**
   * Check if we're in a live chat room
   * @returns {boolean} Whether we're in a live chat room
   */
  static get inLiveRoom() {
    return window.location.pathname.includes('/rooms/') && !this.inConversation;
  }

  /**
   * Check if we're in a transcript page
   * @returns {boolean} Whether we're in a transcript page
   */
  static get inTranscript() {
    return window.location.pathname.includes('/transcript/');
  }

  /**
   * Check in we're in a conversation aka bookmark.
   * @returns {boolean} Whether we're in a conversation/bookmark page
   */
  static get inConversation() {
    // this split will turn into this for a conversation:
    // ["", "rooms", "11", "conversation", "conversation-name-goes-here" ]
    const pathParts = window.location.pathname.split('/', 5);
    return pathParts.length >= 5 && pathParts[3] === 'conversation';
  }

  /**
   * Check if the room is live, i.e. new messages will be arriving.
   */
  static get isLive() {
    return this.inLiveRoom;
  }

  static get roomId() {
    // this split will turn into one of these for the Fate room:
    // ["", "room", "11"]
    // ["", "transcript", "11"]
    const pathParts = window.location.pathname.split('/', 3);
    return pathParts[2];
  }

  /**
   * Check to see if the chat room is on RPG.SE.
   * Other chat rooms don't have dice, so there's no point in running the script there.
   */
  static chatroomIsOnRpgSe() {
    return document.querySelector('#footer-logo a:link')?.getAttribute('href')?.includes('rpg.stackexchange.com') ?? false;
  }

  /**
   * Get the main chat element
   * @returns {HTMLElement} The main chat element
   */
  static getChatElement() { 
    if (ChatUtil.inTranscript) {
      return document.getElementById('transcript');
    } else if (ChatUtil.inConversation) {
      return document.getElementById('conversation');
    }
    return document.getElementById('chat');
  }
}

class Log {
  static get prefix() { return `🎲 RPG.SE Fudge Dice:`; }

  static error(errorMessage, innerError) {
    const message = `${Log.prefix} ${errorMessage}`;

    if (innerError) {
      console.error(message, innerError);
    } else {
      console.error(message);
    }
  }
}

/**
 * Configuration store for the user's settings.
 */
class UserConfig {
  constructor() {
    this.store = 'userConfig';
    this.useColors = false;
    this.plusColor = '#008800';
    this.minusColor = '#CC0000';
    this.rooms = ['8403', '11']; // Fate chat room, TRPG General chat
  }

  get isActiveHere() {
    return this.rooms.includes(ChatUtil.roomId);
  }

  /**
   * Prime localStorage for use
   */
  init() {
    if (!localStorage.getItem(this.store)) {
      // Store defaults
      this.save();
    }

    this.load();
  }

  /**
   * Save the current config
   */
  save() {
    const config = {
      'useColors': this.useColors,
      'plusColor': this.plusColor,
      'minusColor': this.minusColor,
      'rooms': this.rooms
    };
    localStorage.setItem(this.store, JSON.stringify(config));
  }

  /**
   * Load the user's config
   * 
   * @public
   */
  load() {
    const config = JSON.parse(localStorage.getItem(this.store));
    this.useColors = config.useColors ?? this.useColors;
    this.plusColor = config.plusColor ?? this.plusColor;
    this.minusColor = config.minusColor ?? this.minusColor;
    this.rooms = config.rooms ?? this.rooms;
  }
  
  /**
   * Activate the current room.
   * 
   * Note this doesn't actually affect the page, just the settings.
   */
  activateRoom() {
    if (this.isActiveHere) {
      return;
    }
    this.rooms.push(ChatUtil.roomId);
  }

  /**
   * Deactivate the current room.
   * 
   * Note this doesn't actually affect the page, just the settings.
   */
  deactivateRoom() {
    this.rooms = this.rooms.filter(id => id !== ChatUtil.roomId);
  }
}

/**
 * A service that manages chat messages.
 */
class ChatService {
  constructor() {
    this.debouncedScan = debounce(() => this.scan(), 50);
  }

  /**
   * Initialise chat message handling.
   * @public
   */
  init() {
    if (!ChatUtil.getChatElement()) {
      Log.error('Tried to initialise ChatService, but no chat element found!');
      throw Error('Failed to initialise ChatService');
    }

    // Mark the root chat element
    const chat = ChatUtil.getChatElement();
    chat.classList.add(HtmlName.CLS_FUDGE_ROOT);

    // Run a one-off scan.
    this.debouncedScan();

    // If we're in a live room, keep scanning whenever new messages arrive.
    if (ChatUtil.isLive) {
      this.startLiveScan();
    }
  }

  /**
   * Commence live scanning the chat for new messages.
   */
  startLiveScan() {
    const observer = new MutationObserver((mutations, obs) => {
      try {
        this.debouncedScan();
      } catch (e) {
        Log.error('Live scan threw an error. It has been aborted and will no longer run.', e);
        obs.disconnect();
      }
    });
    
    observer.observe(ChatUtil.getChatElement(), {
      childList: true,
      subtree: true
    });
  }

  /**
   * Annotate any unconverted D6 values as fudge dice
   * @public
   */
  scan() {
    const dice = Array.from(document.querySelectorAll(`.six-sided-die:not(.${HtmlName.CLS_FUDGE_DIE})`));

    dice.forEach(die => {
      if (die.classList.contains(HtmlName.CLS_FUDGE_DIE)) {
        // The die has somehow already been processed.
        return;
      }

      die.classList.add(HtmlName.CLS_FUDGE_DIE);

      const d6score = Array.from(die.querySelectorAll('.dot')).map(dot => dot.textContent).filter(text => text.includes('•')).length;
      const fudgeScore = FudgeUtil.d6toFudge(d6score);
      const fudgeDisplay = FudgeUtil.displayScore(fudgeScore);
      
      die.setAttribute(HtmlName.DATA_D6_SCORE, d6score.toString());
      die.setAttribute(HtmlName.DATA_FUDGE_SCORE, fudgeScore.toString());

      const symbol = document.createElement('span');
      symbol.classList.add(HtmlName.CLS_FUDGE_DIE_FACE_SYMBOL);
      symbol.innerHTML = fudgeDisplay;

      const face = document.createElement('div');
      face.classList.add(HtmlName.CLS_FUDGE_DIE_FACE);
      face.title = `Rolled ${d6score}`;
      face.append(symbol);
      
      die.appendChild(face);
    });
  }
}

/**
 * The CSS manager is a service that handles the CSS embedded on the page.
 */
class CssService {
  /**
   * Construct a new CSS manager
   * @param {UserConfig} userConfig The user configuration
   */
  constructor(userConfig) {
    this.userConfig = userConfig;
  }

  /**
   * Create the on-page CSS
   */
  init() {
    this.css = document.createElement('style');
    this.css.id = 'rpgse-chat-fudge-dice-css';
    this.css.innerHTML = this.getCssContent();
    document.head.appendChild(this.css);
  }

  /**
   * Update the CSS and on-page configuration.
   */
  update() {
    this.css.innerHTML = this.getCssContent();
    
    const root = document.querySelector(`.${HtmlName.CLS_FUDGE_ROOT}`);
    this.setClass(root, HtmlName.CLS_FUDGE_ON, this.userConfig.isActiveHere);
    this.setClass(root, HtmlName.CLS_FUDGE_COLORS_ON, this.userConfig.useColors);
  }

  /**
   * Sets a class to present/hidden 
   * 
   * @param {HTMLElement} element the element to set the class on
   * @param {string} className The class name to add/remove
   * @param {boolean} condition Whether the class should be present
   */
  setClass(element, className, condition) {
    if (condition) {
      element.classList.add(className);
    } else {
      element.classList.remove(className);
    }
  }

  /**
   * Get the CSS for this userscript
   * @returns {string} A CSS file
   */
  getCssContent() {
    const root = `.${HtmlName.CLS_FUDGE_ROOT}`;
    const fudgeOn = `.${HtmlName.CLS_FUDGE_ON}`;
    const colorsOn = `.${HtmlName.CLS_FUDGE_COLORS_ON}`;
    const fudgeDie = `.${HtmlName.CLS_FUDGE_DIE}`;
    const fudgeDieFace = `.${HtmlName.CLS_FUDGE_DIE_FACE}`;
    const fudgeDieFaceSymbol = `.${HtmlName.CLS_FUDGE_DIE_FACE_SYMBOL}`;

    return `
      ${root}:not(${fudgeOn}) ${fudgeDieFace} {
        display: none;
      }

      ${root}${fudgeOn} .dot {
        display: none;
      }

      ${root}${fudgeOn} ${fudgeDie},
      ${fudgeDieFace} {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      ${fudgeDieFace} {
        cursor: help;
        font-size: 30px;
        font-weight: bold;
        min-width: 30px;
        min-height: 30px;
      }

      ${fudgeDieFaceSymbol} {
        display: inline-block;
      }

      ${root}${fudgeOn} ${fudgeDie}[${HtmlName.DATA_FUDGE_SCORE}='${FudgeScore.Minus}'] {
        color: var(${HtmlName.VAR_FUDGE_DICE_MINUS_COLOR});
      }

      ${root}${fudgeOn} ${fudgeDie}[${HtmlName.DATA_FUDGE_SCORE}='${FudgeScore.Plus}'] {
        color: var(${HtmlName.VAR_FUDGE_DICE_PLUS_COLOR});
      }

      ${root}${fudgeOn} {
        ${HtmlName.VAR_FUDGE_DICE_PLUS_COLOR}: inherit;
        ${HtmlName.VAR_FUDGE_DICE_MINUS_COLOR}: inherit;
      }

      ${root}${fudgeOn}${colorsOn} {
        ${HtmlName.VAR_FUDGE_DICE_PLUS_COLOR}: ${this.userConfig.plusColor};
        ${HtmlName.VAR_FUDGE_DICE_MINUS_COLOR}: ${this.userConfig.minusColor};
      }

      .fudge-menu-button {
        cursor: pointer;
        user-select: none;
      }

      .fudge-menu {
        border: 1px solid #E0DCBF;
        background-color: rgb(250, 250, 250);
        padding: 10px;
        color: #444444;
        margin-bottom: 1em;
      }

      .fudge-menu * {
        box-sizing: border-box;
      }

      .fudge-menu:not(.fudge-menu--open) {
        display: none;
      }

      .fudge-menu h3 {
        margin-bottom: 0.5em;
      }

      .fudge-menu .fudge-menu-options {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
      }

      .fudge-menu input[type='color'] {
        background: none;
        border: 0;
        cursor: pointer;
        margin: 0;
        padding: 0;
        width: 20px;
        height: 20px;
      }

      .fudge-menu input[type='text'] {
        height: 20px;
      }

      .fudge-menu label {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 8px;
      }

      .fudge-menu .color-picker input[type='text'] {
        width: 7em;
      }

      .fudge-menu .toggler {
        cursor: pointer;
        user-select: none;
      }
    `;
  }
}

class FormComponent {
  constructor() {
    /** @type {HTMLElement} */
    this.element = document.createElement('label');

    /**
     * The onChange callback. Overwrite this to listen to changes.
     * @param {boolean} value The new value
     */
    /* eslint-disable-next-line no-unused-vars */
    this.onChange = (value) => null;
  }

  /**
   * Alert listeners to a change.
   * 
   * @private
   */
  invokeChangeCallback() {
    this.onChange(this.value);
  }
}

class ColorPickerComponent extends FormComponent {
  /**
   * Get or set the value of this color picker.
   * @returns {string} The color value
   */
  get value() {
    return this.text.value;
  }

  set value(newValue) {
    let updated = false;
    if (this.picker.value !== newValue) {
      this.picker.value = newValue;
      updated = true;
    }
    if (this.text.value !== newValue) {
      this.text.value = newValue;
      updated = true;
    }
    if (updated) {
      this.invokeChangeCallback();
    }
  }

  /**
   * Create a new color picker component.
   * @param {string} labelText The text for this picker
   * @param {string} defaultValue The default color value
   */
  constructor(labelText, defaultValue) {
    super();
    this.picker = document.createElement('input');
    this.picker.type = 'color';
    this.picker.addEventListener('change', () => {
      this.value = this.picker.value;
    });

    this.text = document.createElement('input');
    this.text.type = 'text';
    this.text.maxLength = 7;
    this.text.pattern = '#([a-zA-Z0-9]{3}|[a-zA-Z0-9]{6})';
    this.text.addEventListener('change', () => {
      this.value = this.text.value;
    });

    const label = document.createElement('span');
    label.innerText = labelText;

    this.element = document.createElement('label');
    this.element.append(this.picker, this.text, label);
    this.element.classList.add('color-picker');

    this.value = defaultValue;
  }
}

class ToggleComponent extends FormComponent {
  /**
   * Get or set the value of this toggle component.
   * @returns {string} The toggle value
   */
  get value() {
    return this.input.checked;
  }

  set value(newValue) {
    if (this.input.checked !== newValue) {
      this.input.checked = newValue;
      this.invokeChangeCallback();
    }
  }

  /**
   * Create a new toggle component.
   * @param {string} labelText The text for this element
   * @param {boolean} defaultValue The default toggle value
   */
  constructor(labelText, defaultValue) {
    super();
    this.input = document.createElement('input');
    this.input.type = 'checkbox';
    this.input.addEventListener('change', () => {
      this.invokeChangeCallback();
    });

    const label = document.createElement('span');
    label.innerText = labelText;

    this.element = document.createElement('label');
    this.element.append(this.input, label);
    this.element.classList.add('toggler');

    this.value = defaultValue;
  }
}

class ConfigMenuService {
  /**
   * Create a new config menu service.
   * @param {UserConfig} userConfig The user configuration
   * @param {CssService} cssService The css service
   */
  constructor(userConfig, cssService) {
    this.userConfig = userConfig;
    this.cssService = cssService;
  }

  /** Initialise the config menu service and create the UI. */
  init() {
    this.fudgeOn = new ToggleComponent('Use fudge dice here', this.userConfig.isActiveHere);
    this.colorsOn = new ToggleComponent('Color the fudge dice', this.userConfig.useColors);
    this.plusColorInput = new ColorPickerComponent('Plus color', this.userConfig.plusColor);
    this.minusColorInput = new ColorPickerComponent('Minus color', this.userConfig.minusColor);

    this.fudgeOn.onChange = value => {
      if (value) {
        this.userConfig.activateRoom();
      } else {
        this.userConfig.deactivateRoom();
      }
      this.userConfig.save();
      this.cssService.update();
    };

    this.colorsOn.onChange = value => {
      this.userConfig.useColors = value;
      this.userConfig.save();
      this.cssService.update();
    };

    this.plusColorInput.onChange = value => {
      this.userConfig.plusColor = value;
      this.userConfig.save();
      this.cssService.update();
    };

    this.minusColorInput.onChange = value => {
      this.userConfig.minusColor = value;
      this.userConfig.save();
      this.cssService.update();
    };

    this.createUi();
  }

  createUi() {
    const menuButton = this.createMenuButton();
    const menu = this.createMenu();

    const sidebarMenu = document.getElementById('sidebar-menu');
    
    sidebarMenu.append(' | ');
    sidebarMenu.appendChild(menuButton);
    sidebarMenu.insertAdjacentElement('afterend', menu);

    menuButton.addEventListener('click', () => {
      menu.classList.toggle('fudge-menu--open');
    });
  }

  /**
   * Create the element that opens/closes the menu.
   */
  createMenuButton() {
    const button = document.createElement('a');
    button.innerHTML = '&pm; fudge dice';
    button.classList.add('fudge-menu-button');
    return button;
  }

  /**
   * Create the main menu UI element.
   */
  createMenu() {
    const menu = document.createElement('section');
    menu.classList.add('fudge-menu');

    const header = document.createElement('h3');
    header.innerText = 'Fudge dice config';
    menu.appendChild(header);

    const options = document.createElement('div');
    options.classList.add('fudge-menu-options');
    options.append(
      this.fudgeOn.element,
      this.colorsOn.element,
      this.plusColorInput.element,
      this.minusColorInput.element
    );
    menu.appendChild(options);

    return menu;
  }
}

/**
 * The main start class.
 * @abstract
 */
class Main {
  /**
   * Start the script
   * @public
   */
  static start() {
    // Remain inactive for non-RPG.SE chat rooms
    if (!ChatUtil.chatroomIsOnRpgSe()) { return; }

    const userConfig = new UserConfig();
    userConfig.init();

    const chatMessages = new ChatService();
    chatMessages.init();

    const cssManager = new CssService(userConfig);
    cssManager.init();
    cssManager.update();

    const configMenu = new ConfigMenuService(userConfig, cssManager);
    configMenu.init();
  }
}

Main.start();
