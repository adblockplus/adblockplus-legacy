/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2016 Eyeo GmbH
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

let {port} = require("messaging");

// Only initialize after receiving a "response" to a dummy message - this makes
// sure that on update the old version has enough time to receive and process
// the shutdown message.
port.emitWithResponse("ping").then(() =>
{
  require("child/elemHide");
  require("child/contentPolicy");
  require("child/contextMenu");
  require("child/dataCollector");
  require("child/cssProperties");
  require("child/subscribeLinks");
});
