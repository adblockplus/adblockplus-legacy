#!/usr/bin/perl

# This script will adjust the locales as received from Babelzilla - normalize
# newlines and remove comments that have been pointlessly copied over from
# en-US.
 
use strict;
use warnings;

$0 =~ s/(.*[\\\/])//g;
chdir($1) if $1;

opendir(local* LOCALES, "chrome/locale") or die "Failed to open directory chrome/locale";
foreach my $locale (readdir(LOCALES))
{
  next if $locale =~ /^\./ || $locale eq "en-US" || $locale eq "de" || $locale eq "ru";

  foreach my $file (<chrome/locale/$locale/*.properties>)
  {
    my $data = readFile($file);
    $data =~ s/\r//g;                   # Normalize newlines
    $data =~ s/^\s*#.*\n*//gm;          # Remove pointless comments
    writeFile($file, $data);
  }

  foreach my $file (<chrome/locale/$locale/*.dtd>)
  {
    my $data = readFile($file);
    $data =~ s/\r//g;                         # Normalize newlines
    $data =~ s/[^\S\n]*<!--.*?-->\s*?\n*//gs; # Remove pointless comments
    writeFile($file, $data);
  }
}
closedir(LOCALES);

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
