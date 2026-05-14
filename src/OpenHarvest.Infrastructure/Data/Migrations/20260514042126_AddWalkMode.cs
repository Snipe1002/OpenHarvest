using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OpenHarvest.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddWalkMode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "captures",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    WalkSessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    YardId = table.Column<Guid>(type: "uuid", nullable: false),
                    PhotoObjectKey = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    CapturedUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    GpsLat = table.Column<double>(type: "double precision", nullable: true),
                    GpsLng = table.Column<double>(type: "double precision", nullable: true),
                    GpsAccuracyMeters = table.Column<double>(type: "double precision", nullable: true),
                    ManualReadings = table.Column<string>(type: "jsonb", nullable: false),
                    Note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    ClassificationError = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    ClassifiedUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_captures", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "classification_proposals",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CaptureId = table.Column<Guid>(type: "uuid", nullable: false),
                    YardId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Confidence = table.Column<double>(type: "double precision", nullable: false),
                    Payload = table.Column<string>(type: "jsonb", nullable: true),
                    PromotedEntityId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_classification_proposals", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "walk_sessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    YardId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartedUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EndedUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_walk_sessions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "yards",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Slug = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CentroidLat = table.Column<double>(type: "double precision", nullable: true),
                    CentroidLng = table.Column<double>(type: "double precision", nullable: true),
                    GardenId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_yards", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_captures_Status",
                table: "captures",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_captures_WalkSessionId_CapturedUtc",
                table: "captures",
                columns: new[] { "WalkSessionId", "CapturedUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_captures_YardId",
                table: "captures",
                column: "YardId");

            migrationBuilder.CreateIndex(
                name: "IX_classification_proposals_CaptureId",
                table: "classification_proposals",
                column: "CaptureId");

            migrationBuilder.CreateIndex(
                name: "IX_classification_proposals_YardId",
                table: "classification_proposals",
                column: "YardId");

            migrationBuilder.CreateIndex(
                name: "IX_walk_sessions_YardId_StartedUtc",
                table: "walk_sessions",
                columns: new[] { "YardId", "StartedUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_yards_Slug",
                table: "yards",
                column: "Slug",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "captures");

            migrationBuilder.DropTable(
                name: "classification_proposals");

            migrationBuilder.DropTable(
                name: "walk_sessions");

            migrationBuilder.DropTable(
                name: "yards");
        }
    }
}
