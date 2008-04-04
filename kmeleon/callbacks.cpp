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
 * Portions created by the Initial Developer are Copyright (C) 2006-2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

#include "adblockplus.h"
 
WNDPROC origWndProc = NULL;
WNDPROC origDialogWndProc = NULL;
HHOOK hook = NULL;

BOOL APIENTRY DllMain(HINSTANCE hinstDLL, DWORD fdwReason, LPVOID lpvReserved) {
  return TRUE;
}

LRESULT CALLBACK WndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam) {
  if (message == WM_COMMAND) {
    WORD command = LOWORD(wParam) - cmdBase;
    char* commandName;
    PRBool done = PR_TRUE;
    switch (command) {
      case CMD_PREFERENCES:
        commandName = "settings";
        break;
      case CMD_LISTALL:
        commandName = "blockable";
        break;
      case CMD_TOGGLEENABLED:
        commandName = "enable";
        break;
      case CMD_IMAGE:
        commandName = "image";
        break;
      case CMD_OBJECT:
        commandName = "object";
        break;
      case CMD_FRAME:
        commandName = "frame";
        break;
      case CMD_TOOLBAR:
        commandName = "toolbar";
        break;
      case CMD_STATUSBAR:
        commandName = "statusbar";
        break;
      default:
        commandName = "menu";
        done = PR_FALSE;
        break;
    }

    abpJSContextHolder holder;
    JSObject* overlay = UnwrapJSObject(fakeBrowserWindow);
    JSContext* cx = holder.get();
    if (cx != nsnull && overlay != nsnull) {
      JSString* str = JS_NewStringCopyZ(cx, commandName);
      if (str != nsnull) {
        jsval retval;
        jsval args[] = {STRING_TO_JSVAL(str), INT_TO_JSVAL(hWnd), INT_TO_JSVAL(LOWORD(wParam))};
        JS_CallFunctionName(cx, overlay, "onCommand", 3, args, &retval);
      }
    }
    if (done)
      return TRUE;
  }
  else if (((message == TB_MBUTTONDOWN || message == TB_MBUTTONDBLCLK) && wParam == cmdBase + CMD_TOOLBAR) ||
           ((message == SB_MBUTTONDOWN || message == SB_MBUTTONDBLCLK) && wParam == cmdBase + CMD_STATUSBAR)) {
    abpJSContextHolder holder;
    char param[] = "enable";
    JSObject* overlay = UnwrapJSObject(fakeBrowserWindow);
    JSContext* cx = holder.get();
    if (cx != nsnull && overlay != nsnull) {
      JSString* str = JS_NewString(cx, param, strlen(param));
      if (str != nsnull) {
        jsval arg = STRING_TO_JSVAL(str);
        jsval retval;
        JS_CallFunctionName(cx, overlay, "onCommand", 1, &arg, &retval);
      }
    }
  }
  else if ((message == TB_RBUTTONDOWN && wParam == cmdBase + CMD_TOOLBAR) ||
           (message == SB_RBUTTONDOWN && wParam == cmdBase + CMD_STATUSBAR)) {
    ShowContextMenu(hWnd, message != TB_RBUTTONDOWN);
  }
  else if (message == WM_NOTIFY) {
    LPNMHDR notifyHeader = (LPNMHDR) lParam;
    if ((notifyHeader->code == (UINT)TTN_NEEDTEXTA || notifyHeader->code == (UINT)TTN_NEEDTEXTW) &&
        (wParam == cmdBase + CMD_TOOLBAR || wParam == cmdBase + CMD_STATUSBAR)) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapJSObject(fakeBrowserWindow);
      JSContext* cx = holder.get();
      if (cx != nsnull && overlay != nsnull) {
        jsval args[] = {
            wParam == cmdBase + CMD_STATUSBAR ? JSVAL_TRUE : JSVAL_FALSE,
            notifyHeader->code == (UINT)TTN_NEEDTEXTW ? JSVAL_TRUE : JSVAL_FALSE
        };
        jsval retval;
        if (JS_CallFunctionName(cx, overlay, "getTooltipText", 2, args, &retval)) {
          JSString* text = JS_ValueToString(cx, retval);
          if (notifyHeader->code == (UINT)TTN_NEEDTEXTA)
          {
              LPTOOLTIPTEXTA lpTiptext = (LPTOOLTIPTEXTA) lParam;
              lpTiptext->lpszText = JS_GetStringBytes(text);
          }
          else
          {
              LPTOOLTIPTEXTW lpTiptext = (LPTOOLTIPTEXTW) lParam;
              lpTiptext->lpszText = (LPWSTR)JS_GetStringChars(text);
          }
          return 0;
        }
      }
    }
  }

  if (IsWindowUnicode(hWnd))
    return CallWindowProcW(origWndProc, hWnd, message, wParam, lParam);
  else
    return CallWindowProcA(origWndProc, hWnd, message, wParam, lParam);
}

LRESULT CALLBACK DialogWndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam) {
  LRESULT retVal;
  if (IsWindowUnicode(hWnd))
    retVal = CallWindowProcW(origDialogWndProc, hWnd, message, wParam, lParam);
  else
    retVal = CallWindowProcA(origDialogWndProc, hWnd, message, wParam, lParam);

  char* eventHandler;
  switch (message) {
    case WM_SIZE:
      eventHandler = "onDialogResize";
      break;
    case WM_MOVE:
      eventHandler = "onDialogMove";
      break;
    default:
      eventHandler = nsnull;
      break;
  }

  if (eventHandler) {
    abpJSContextHolder holder;
    JSObject* overlay = UnwrapJSObject(fakeBrowserWindow);
    if (holder.get() && overlay) {
      jsval retval;
      jsval arg = INT_TO_JSVAL((int32)hWnd);

      JS_CallFunctionName(holder.get(), overlay, eventHandler, 1, &arg, &retval);
    }
  }

  return retVal;
}

LRESULT CALLBACK HookProc(int nCode, WPARAM wParam, LPARAM lParam) {
  if (nCode == HC_ACTION) {
    CWPRETSTRUCT* params = (CWPRETSTRUCT*)lParam;
    if (params->message == WM_DRAWITEM) {
      DRAWITEMSTRUCT* dis = (DRAWITEMSTRUCT*)params->lParam;
      WORD id = dis->itemID - cmdBase;
      if (dis->CtlType == ODT_MENU && id < NUM_COMMANDS)
        ImageList_Draw(hImages, 0, dis->hDC, dis->rcItem.left + 1, dis->rcItem.top + 1, ILD_TRANSPARENT);
    }
  }

  return CallNextHookEx(hook, nCode, wParam, lParam);
}
