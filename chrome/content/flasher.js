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
 * Portions created by the Initial Developer are Copyright (C) 2006
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/*
 * Draws a blinking border for a list of matching nodes.
 * This file is included from nsAdblockPlus.js.
 */

var flasher = {
  inseclNodes: null,
  count: 0,
  timer: null,

  flash: function(inseclNodes)
  {
    this.stop();
    if (!inseclNodes)
      return;

    this.inseclNodes = inseclNodes;
    this.count = 0;

    this.doFlash();
  },

  doFlash: function()
  {
    if (this.count >= 6)
    {
      this.switchOff();
      this.inseclNodes = null;
      return;
    }

    if (this.count % 2)
      this.switchOff();
    else
      this.switchOn();

    this.count++;

    this.timer = createTimer(function() {flasher.doFlash()}, 300);
  },

  stop: function()
  {
    if (this.inseclNodes != null)
    {
      if (this.timer)
        this.timer.cancel();
      this.switchOff();
      this.inseclNodes = null;
    }
  },

  setOutline: function(value)
  {
    for (var i = 0; i < this.inseclNodes.length; i++) {
      var insecNode = this.inseclNodes[i];
      var insecContentBody = secureGet(insecNode, "document", "body");
      if (insecContentBody)
        insecNode = insecContentBody;   // for frames

      secureSet(insecNode, "style", "MozOutline", value);
    }
  },

  switchOn: function()
  {
    this.setOutline("#CC0000 dotted 2px");
  },

  switchOff: function() {
    this.setOutline("none");
  }
};

abp.flasher = flasher;
