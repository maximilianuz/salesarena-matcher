#!/bin/bash

# Sales Arena Matcher - Push Landing Page Script
# Automatiza: git add, git commit, git push

set -e  # Exit on error

echo "🚀 Sales Arena Matcher - Push Landing Page"
echo "=========================================="

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Check if we're in a git repository
if [ ! -d .git ]; then
    echo -e "${YELLOW}❌ No .git directory found${NC}"
    echo "Make sure you're in the project root directory"
    exit 1
fi

echo -e "${BLUE}📋 Checking git status...${NC}"
git status

# Step 2: Stage all changes
echo -e "${BLUE}📝 Staging changes...${NC}"
git add .

# Step 3: Commit with message
COMMIT_MESSAGE="feat: implement landing page for Google OAuth verification"
echo -e "${BLUE}💾 Creating commit...${NC}"
git commit -m "$COMMIT_MESSAGE" || {
    echo -e "${YELLOW}⚠️  Nothing to commit (working tree clean)${NC}"
    exit 0
}

# Step 4: Get current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo -e "${BLUE}🌿 Current branch: ${CURRENT_BRANCH}${NC}"

# Step 5: Push to remote
echo -e "${BLUE}🚀 Pushing to GitHub...${NC}"
git push -u origin "$CURRENT_BRANCH"

# Step 6: Success message
echo -e "${GREEN}✅ Success!${NC}"
echo "=========================================="
echo -e "Landing page pushed to ${CURRENT_BRANCH}"
echo "Netlify will deploy in 2-5 minutes"
echo ""
echo "Monitor deployment:"
echo "  1. Go to https://app.netlify.com"
echo "  2. Select 'salesarena-matcher' project"
echo "  3. Check 'Deployments' tab"
echo ""
echo "View live site:"
echo "  https://sales-arena-matcher.com"
echo ""
echo -e "${GREEN}🎉 Done!${NC}"
