#!/usr/bin/perl

#############################################################################
# This script will create a development build of the extension. Without any #
# command line arguments it will include all available locales in the       #
# development build, command line arguments are interpreted as a list of    #
# locales to be included.                                                   #
#                                                                           #
# Creating a development build with all locales:                            #
#                                                                           #
#   perl make_devbuild.pl                                                   #
#                                                                           #
# Creating a development build with en-US locale only:                      #
#                                                                           #
#   perl make_devbuild.pl en-US                                             #
#                                                                           #
# Creating a development build with English, German and Russian locales:    #
#                                                                           #
#   perl make_devbuild.pl en-US de-DE ru-RU                                 #
#                                                                           #
#############################################################################

use strict;

my $manifest = readFile("chrome.manifest");
unless ($manifest =~ /\bjar:chrome\/(\S+?)\.jar\b/)
{
  die "Could not find JAR file name in chrome.manifest";
}
my $baseName = $1;

open(VERSION, "version");
my $version = <VERSION>;
$version =~ s/[^\w\.]//gs;
close(VERSION);

# Pad the version with zeroes to get version comparisons
# right (1.2+ > 1.2.1 but 1.2.0+ < 1.2.1)
$version .= ".0" while ($version =~ tr/././ < 2);

my ($sec, $min, $hour, $day, $mon, $year) = localtime;
my $build = sprintf("%04i%02i%02i%02i", $year+1900, $mon+1, $day, $hour);

my $locale = (@ARGV ? "-" . join("-", @ARGV) : "");
@ARGV = ("$baseName-$version+.$build$locale.xpi", "+.$build", @ARGV);
do './create_xpi.pl';
die $@ if $@;

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
