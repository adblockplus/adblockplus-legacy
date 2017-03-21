/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2017 eyeo GmbH
 *
 * Adblock Plus is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Plus is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Plus.  If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * @fileOverview Draws a blinking border for a list of matching elements.
 */

function Flasher(elements, scrollToItem)
{
  if (scrollToItem && elements[0].ownerDocument)
  {
    // Ensure that at least one element is visible when flashing
    elements[0].scrollIntoView();
  }

  this.elements = elements;
  this.count = 0;

  this.doFlash();

}
Flasher.prototype =
{
  elements: null,
  count: 0,
  timer: null,

  doFlash: function()
  {
    if (this.count >= 12)
    {
      this.stop();
      return;
    }

    if (this.count % 2)
      this.switchOff();
    else
      this.switchOn();

    this.count++;

    this.timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    this.timer.initWithCallback(() => this.doFlash(), 300, Ci.nsITimer.TYPE_ONE_SHOT);
  },

  stop: function()
  {
    if (this.timer)
    {
      this.timer.cancel();
      this.timer = null;
    }

    if (this.elements)
    {
      this.switchOff();
      this.elements = null;
    }
  },

  setOutline: function(outline, offset)
  {
    for (let element of this.elements)
    {
      if (!Cu.isDeadWrapper(element) && "style" in element)
      {
        element.style.outline = outline;
        element.style.outlineOffset = offset;
      }
    }
  },

  switchOn: function()
  {
    this.setOutline("#CC0000 dotted 2px", "-2px");
  },

  switchOff: function()
  {
    this.setOutline("", "");
  }
};

exports.Flasher = Flasher;
