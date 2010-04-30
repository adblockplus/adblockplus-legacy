/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Adblock Plus.
 *
 * The Initial Developer of the Original Code is
 * Wladimir Palant.
 * Portions created by the Initial Developer are Copyright (C) 2006-2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/**
 * @fileOverview Debugging module used for load time measurements.
 */

var EXPORTED_SYMBOLS = ["TimeLine"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let nestingCounter = 0;
let firstTimeStamp = null;
let lastTimeStamp = null;

/**
 * Time logging module, used to measure startup time of Adblock Plus (development builds only).
 * @class
 */
var TimeLine = {
  /**
   * Logs an event to console together with the time it took to get there.
   */
  log: function(/**String*/ message, /**Boolean*/ _forceDisplay)
  {
    if (!_forceDisplay && nestingCounter <= 0)
      return;

    let now = Date.now();
    let diff = lastTimeStamp ? (now - lastTimeStamp) : "first event";
    lastTimeStamp = now;

    // Indent message depending on current nesting level
    for (let i = 0; i < nestingCounter; i++)
      message = "* " + message;

    // Pad message with spaces
    let padding = [];
    for (let i = message.toString().length; i < 40; i++)
      padding.push(" ");
    dump("ABP timeline: " + message + padding.join("") + "\t (" + diff + ")\n");
  },

  /**
   * Called to indicate that application entered a block that needs to be timed.
   */
  enter: function(/**String*/ message)
  {
    if (nestingCounter <= 0)
      firstTimeStamp = Date.now();

    this.log(message, true);
    nestingCounter = (nestingCounter <= 0 ? 1 : nestingCounter + 1);
  },

  /**
   * Called when application exited a block that TimeLine.enter() was called for.
   */
  leave: function(/**String*/ message)
  {
    nestingCounter--;
    this.log(message, true);

    if (nestingCounter <= 0)
    {
      if (firstTimeStamp !== null)
        dump("ABP timeline: Total time elapsed: " + (Date.now() - firstTimeStamp) + "\n");
      firstTimeStamp = null;
      lastTimeStamp = null;
    }
  }
};
