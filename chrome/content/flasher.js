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
  nodes: null,
  count: 0,
  timer: null,

  getCoords: function(node) {
    if (!node.ownerDocument)
      return null;

    var box = null;
    try {
      box = node.ownerDocument.getBoxObjectFor(node);
    } catch(e) {}
    if (!box)
      return null;

    var ret = [0, 0, box.screenX, box.screenY];
    while (box) {
      ret[0] += box.x;
      ret[1] += box.y;

      var newBox = null;
      try {
        newBox = node.ownerDocument.getBoxObjectFor(box.parentBox);
      } catch(e) {}
      if (newBox && newBox != box)
        box = newBox;
      else
        box = null;
    }

    return ret;
  },

  visibleCoords: function(wnd, coords) {
    var minX = wnd.scrollX;
    var maxX = minX + wnd.innerWidth;
    var minY = wnd.scrollY;
    var maxY = minY + wnd.innerHeight;

    return (coords[0] >= minX && coords[0] < maxX &&
            coords[1] >= minY && coords[1] < maxY);
  },

  flash: function(nodes) {
    this.stop();
    if (!nodes)
      return;

    nodes = nodes.slice();
    if (nodes.length && prefs.flash_scrolltoitem) {
      // Ensure that at least one node is visible when flashing
      var minCoords = null;
      var showWnd = null;
      for (var i = 0; i < nodes.length; i++) {
        if ("document" in nodes[i] && nodes[i].document && nodes[i].document.body)
          nodes[i] = nodes[i].document.body;   // for frames

        var coords = this.getCoords(nodes[i]);
        if (!coords)
          continue;

        if (!nodes[i].ownerDocument || !nodes[i].ownerDocument.defaultView)
          continue;

        var wnd = nodes[i].ownerDocument.defaultView;

        // Check whether node's top left corner is already visible
        if (this.visibleCoords(wnd, coords)) {
          minCoords = null;
          showWnd = wnd;
          break;
        }

        // Check whether this node's coordinates are smaller than the ones we found
        if (!minCoords || coords[1] < minCoords[1] || (coords[1] == minCoords[1] && coords[0] < minCoords[0])) {
          minCoords = coords;
          showWnd = wnd;
        }
      }

      if (minCoords)
        showWnd.scrollTo(minCoords[0], minCoords[1]);

      if (showWnd) {
        while (showWnd) {
          var parentNode = showWnd.frameElement;
          showWnd = showWnd.parent;
          if (!parentNode || !showWnd)
            break;

          coords = this.getCoords(parentNode);
          if (coords && !this.visibleCoords(showWnd, coords))
            showWnd.scrollTo(coords[0], coords[1]);
        }
      }
    }

    this.nodes = nodes;
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

    if (this.nodes) {
      this.switchOff();
      this.nodes = null;
    }
  },

  setOutline: function(value) {
    for (var i = 0; i < this.nodes.length; i++)
      if ("style" in this.nodes[i])
        this.nodes[i].style.MozOutline = value;
  },

  switchOn: function() {
    this.setOutline("#CC0000 dotted 2px");
  },

  switchOff: function() {
    this.setOutline("none");
  }
};

abp.flasher = flasher;
