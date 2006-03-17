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

  getCoords: function(insecNode) {
    var insecBox = secureLookup(insecNode, "ownerDocument", "getBoxObjectFor")(insecNode);
    if (!insecBox)
      return null;

    var ret = [0, 0, secureGet(insecBox, "screenX"), secureGet(insecBox, "screenY")];
    while (insecBox) {
      ret[0] += secureGet(insecBox, "x");
      ret[1] += secureGet(insecBox, "y");
      insecBox = secureGet(insecBox, "parentBox");
    }

    return ret;
  },

  visibleCoords: function(insecWnd, coords) {
    var minX = secureGet(insecWnd, "scrollX");
    var maxX = minX + secureGet(insecWnd, "innerWidth");
    var minY = secureGet(insecWnd, "scrollY");
    var maxY = minY + secureGet(insecWnd, "innerHeight");

    return (coords[0] >= minX && coords[0] < maxX &&
            coords[1] >= minY && coords[1] < maxY);
  },

  flash: function(inseclNodes) {
    this.stop();
    if (!inseclNodes)
      return;

    inseclNodes = inseclNodes.slice();
    if (inseclNodes.length) {
      // Ensure that at least one node is visible when flashing
      var minCoords = null;
      var insecShowWnd = null;
      for (var i = 0; i < inseclNodes.length; i++) {
        var insecContentBody = secureGet(inseclNodes[i], "document", "body");
        if (insecContentBody)
          inseclNodes[i] = insecContentBody;   // for frames

        var coords = this.getCoords(inseclNodes[i]);
        if (!coords)
          continue;

        var insecWnd = secureGet(inseclNodes[0], "ownerDocument", "defaultView");
        if (!insecWnd)
          continue;
  
        // Check whether node's top left corner is already visible
        if (this.visibleCoords(insecWnd, coords)) {
          minCoords = null;
          insecShowWnd = insecWnd;
          break;
        }

        // Check whether this node's coordinates are smaller than the ones we found
        if (!minCoords || coords[1] < minCoords[1] || (coords[1] == minCoords[1] && coords[0] < minCoords[0])) {
          minCoords = coords;
          insecShowWnd = insecWnd;
        }
      }

      if (minCoords)
        secureLookup(insecShowWnd, "scrollTo")(minCoords[0], minCoords[1]);

      if (insecShowWnd) {
        while (insecShowWnd) {
          var insecParentNode = secureGet(insecShowWnd, "frameElement");
          var insecShowWnd = secureGet(insecShowWnd, "parent");
          if (!insecParentNode || !insecShowWnd)
            break;

          coords = this.getCoords(insecParentNode);
          if (coords && !this.visibleCoords(insecShowWnd, coords))
            secureLookup(insecShowWnd, "scrollTo")(coords[0], coords[1]);
        }
      }
    }

    this.inseclNodes = inseclNodes;
    this.count = 0;

    this.doFlash();
  },

  doFlash: function() {
    if (this.count >= 6) {
      this.stop();
      return;
    }

    if (this.count % 2)
      this.switchOff();
    else
      this.switchOn();

    this.count++;

    this.timer = createTimer(function() {flasher.doFlash()}, 300);
  },

  stop: function() {
    if (this.timer) {
      this.timer.cancel();
      this.timer = null;
    }

    if (this.inseclNodes) {
      this.switchOff();
      this.inseclNodes = null;
    }
  },

  setOutline: function(value) {
    for (var i = 0; i < this.inseclNodes.length; i++)
      secureSet(this.inseclNodes[i], "style", "MozOutline", value);
  },

  switchOn: function() {
    this.setOutline("#CC0000 dotted 2px");
  },

  switchOff: function() {
    this.setOutline("none");
  }
};

abp.flasher = flasher;
