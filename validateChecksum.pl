#!/usr/bin/perl

# Copyright 2011 Wladimir Palant
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

#############################################################################
# This is a reference script to validate the checksum in downloadable       #
# subscription. This performs the same validation as Adblock Plus when it   #
# downloads the subscription.                                               #
#                                                                           #
# To validate a subscription file, run the script like this:                #
#                                                                           #
#   perl validateChecksum.pl subscription.txt                               #
#                                                                           #
# Note: your subscription file should be saved in UTF-8 encoding, otherwise #
# the validation result might be incorrect.                                 #
#                                                                           #
#############################################################################

use strict;
use warnings;
use Digest::MD5 qw(md5_base64);

die "Usage: $^X $0 subscription.txt\n" unless @ARGV;

my $file = $ARGV[0];
my $data = readFile($file);

# Normalize data
$data =~ s/\r//g;
$data =~ s/\n+/\n/g;

# Extract checksum

# Remove checksum
$data =~ s/^\s*!\s*checksum[\s\-:]+([\w\+\/=]+).*\n//mi;
my $checksum = $1;
die "Couldn't find a checksum in the file\n" unless $checksum;

# Calculate new checksum
my $checksumExpected = md5_base64($data);

# Compare checksums
if ($checksum eq $checksumExpected)
{
  print "Checksum is valid\n";
  exit(0);
}
else
{
  print "Wrong checksum: found $checksum, expected $checksumExpected\n";
  exit(1);
}

sub readFile
{
  my $file = shift;

  open(local *FILE, "<", $file) || die "Could not read file '$file'";
  binmode(FILE);
  local $/;
  my $result = <FILE>;
  close(FILE);

  return $result;
}
