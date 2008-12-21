#!/usr/bin/perl

use strict;
use warnings;

use LWP::Simple;

opendir(local* DIR, "chrome/locale") or die "Could not open directory chrome/locale";
my @locales = grep {!/[^\w\-]/} readdir(DIR);
closedir(DIR);

foreach my $locale (@locales)
{
  print "Processing locale $locale\n";

  my $baseURLTemplate = ($locale eq "en-US" ? "http://hg.mozilla.org/mozilla-central/raw-file/tip/toolkit/locales/%LOCALE%/chrome/global" : "http://hg.mozilla.org/l10n-central/%LOCALE%/raw-file/tip/toolkit/chrome/global");

  my @candidates = ($locale);
  push @candidates, $1 if $locale =~ /^(\w+)-\w+$/;
  my($dtd, $properties);
  foreach my $candidate (@candidates)
  {
    my $baseURL = $baseURLTemplate;
    $baseURL =~ s/%LOCALE%/$candidate/g;

    $dtd = get("$baseURL/findbar.dtd");
    $properties = get("$baseURL/findbar.properties");

    last if $dtd && $properties;
  }
  warn("Failed to retrieve findbar.dtd and findbar.properties for locale $locale") && next unless $dtd && $properties;

  warn("Properties file doesn't have NotFound string for locale $locale") && next unless $properties =~ /^\s*NotFound\s*=\s*(.*)/m;
  my $notFound = $1;
  warn("Properties file doesn't have WrappedToTop string for locale $locale") && next unless $properties =~ /^\s*WrappedToTop\s*=\s*(.*)/m;
  my $wrappedToTop = $1;
  warn("Properties file doesn't have WrappedToBottom string for locale $locale") && next unless $properties =~ /^\s*WrappedToBottom\s*=\s*(.*)/m;
  my $wrappedToBottom = $1;
  warn("Properties file doesn't have NormalFindLabel string for locale $locale") && next unless $properties =~ /^\s*NormalFindLabel\s*=\s*(.*)/m;
  my $findLabel = $1;

  warn("Could not insert find.label entity into DTD file for locale $locale") && next unless $dtd =~ s/<!ENTITY/<!ENTITY find.label "$findLabel">\n$&/;

  my $oldProperties = readFile("chrome/locale/$locale/global.properties");

  warn("Failed to replace NotFound string in global.properties for locale $locale") && next unless $oldProperties =~ s/^\s*NotFound\s*=\s*(.*)/NotFound=$notFound/m;
  warn("Failed to replace WrappedToTop string in global.properties for locale $locale") && next unless $oldProperties =~ s/^\s*WrappedToTop\s*=\s*(.*)/WrappedToTop=$wrappedToTop/m;
  warn("Failed to replace WrappedToBottom string in global.properties for locale $locale") && next unless $oldProperties =~ s/^\s*WrappedToBottom\s*=\s*(.*)/WrappedToBottom=$wrappedToBottom/m;

  writeFile("chrome/locale/$locale/global.properties", $oldProperties);
  writeFile("chrome/locale/$locale/findbar.dtd", $dtd);
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

sub writeFile
{
  my ($file, $contents) = @_;

  open(local *FILE, ">", $file) || die "Could not write file '$file'";
  binmode(FILE);
  print FILE $contents;
  close(FILE);
}
