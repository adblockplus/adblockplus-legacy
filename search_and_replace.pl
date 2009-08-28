#!/usr/bin/perl

use strict;

die "Usage: $^X $0 <regexp> <replaceBy>\n" unless @ARGV >= 2;

my ($from, $to) = @ARGV;

doDir('.');

sub doDir
{
  my $dir = shift;

  opendir(local *DIR, $dir) or die "Could not open directory $dir";
  foreach (readdir(DIR))
  {
    next if !/[^.]/;

    my $path = "$dir/$_";
    if (-f $path)
    {
      doFile($path);
    }
    elsif (-d $path)
    {
      doDir($path);
    }
  }
  closedir(DIR);
}

sub doFile
{
  my $file = shift;

  print "$file\n";
  open(local *FILE, $file) or die "Could not read file $file";
  binmode(FILE);
  local $/;
  my $data = <FILE>;
  my $count = ($data =~ s/$from/$to/g);
  close(FILE);

  if ($count)
  {
    open(FILE, ">$file") or die "Could not write file $file";
    binmode(FILE);
    print FILE $data;
    close(FILE);
  }
}
