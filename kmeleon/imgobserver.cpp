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
 
nsCOMPtr<abpImgObserver> imgObserver = new abpImgObserver();

NS_IMPL_ISUPPORTS2(abpImgObserver, imgIDecoderObserver, imgIContainerObserver)

/**************************************
 * imgIDecoderObserver implementation *
 **************************************/

nsresult abpImgObserver::OnStopFrame(imgIRequest* aRequest, gfxIImageFrame *aFrame) {
  nsresult rv;

  gfx_format format;
  rv = aFrame->GetFormat(&format);
  if (NS_FAILED(rv))
    return rv;

  if (format != gfxIFormats::BGR_A1)
    return NS_ERROR_UNEXPECTED;

  PRInt32 width;
  rv = aFrame->GetWidth(&width);
  if (NS_FAILED(rv))
    return rv;

  PRInt32 height;
  rv = aFrame->GetHeight(&height);
  if (NS_FAILED(rv))
    return rv;

  PRUint32 imageBytesPerRow;
  rv = aFrame->GetImageBytesPerRow(&imageBytesPerRow);
  if (NS_FAILED(rv))
    return rv;

  PRUint8* imageBits;
  PRUint32 imageSize;
  rv = aFrame->GetImageData(&imageBits, &imageSize);
  if (NS_FAILED(rv))
    return rv;
  if (imageSize < height * imageBytesPerRow)
    return NS_ERROR_UNEXPECTED;

  PRUint32 alphaBytesPerRow;
  rv = aFrame->GetAlphaBytesPerRow(&alphaBytesPerRow);
  if (NS_FAILED(rv))
    return rv;

  PRUint8* alphaBits;
  PRUint32 alphaSize;
  rv = aFrame->GetAlphaData(&alphaBits, &alphaSize);
  if (NS_FAILED(rv))
    return rv;
  if (alphaSize < height * alphaBytesPerRow)
    return NS_ERROR_UNEXPECTED;

  HDC hDC = ::GetDC(NULL);

  PRUint32 resultSize = width * height * 4;
  PRUint8* bits = new PRUint8[resultSize];
  for (PRUint32 row = 0, col = 0, n = 0; row < (PRUint32)height && n < resultSize;)
  {
    PRUint32 imageOffset = row * imageBytesPerRow + col * 3;
    bits[n++] = imageBits[imageOffset];
    bits[n++] = imageBits[imageOffset + 1];
    bits[n++] = imageBits[imageOffset + 2];

    PRUint32 alphaOffset = row * alphaBytesPerRow + col / 8;
    bits[n++] = (alphaBits[alphaOffset] & (0x80 >> col % 8) ? 0xFF : 0x00);

    col++;
    if (col >= (PRUint32)width)
    {
      col = 0;
      row++;
    }
  }

  BITMAPINFOHEADER head;
  head.biSize = sizeof(head);
  head.biWidth = width;
  head.biHeight = height / 4;
  head.biPlanes = 1;
  head.biBitCount = 32;
  head.biCompression = BI_RGB;
  head.biSizeImage = resultSize / 4;
  head.biXPelsPerMeter = 0;
  head.biYPelsPerMeter = 0;
  head.biClrUsed = 0;
  head.biClrImportant = 0;

  for (int i = 3; i >= 0; i--)
  {
    HBITMAP image = ::CreateDIBitmap(hDC, NS_REINTERPRET_CAST(CONST BITMAPINFOHEADER*, &head),
                                     CBM_INIT, bits + i * head.biSizeImage,
                                     NS_REINTERPRET_CAST(CONST BITMAPINFO*, &head),
                                     DIB_RGB_COLORS);
    ImageList_Add(hImages, image, NULL);
    DeleteObject(image);
  }

  delete bits;
  ReleaseDC(NULL, hDC);

  DoneLoadingImage();

  return NS_OK;
}

nsresult abpImgObserver::OnStartDecode(imgIRequest* aRequest) {
  return NS_OK;
}
nsresult abpImgObserver::OnStartContainer(imgIRequest* aRequest, imgIContainer *aContainer) {
  return NS_OK;
}
nsresult abpImgObserver::OnStartFrame(imgIRequest* aRequest, gfxIImageFrame *aFrame) {
  return NS_OK;
}
nsresult abpImgObserver::OnDataAvailable(imgIRequest *aRequest, gfxIImageFrame *aFrame, const nsIntRect * aRect) {
  return NS_OK;
}
nsresult abpImgObserver::OnStopContainer(imgIRequest* aRequest, imgIContainer *aContainer) {
  return NS_OK;
}
nsresult abpImgObserver::OnStopDecode(imgIRequest* aRequest, nsresult status, const PRUnichar *statusArg) {
  return NS_OK;
}
nsresult abpImgObserver::FrameChanged(imgIContainer *aContainer, gfxIImageFrame *aFrame, nsIntRect * aDirtyRect) {
  return NS_OK;
}
